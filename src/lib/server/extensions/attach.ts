import { canModerateForum } from '../admin';
import { createForumRecordAsGiven, deleteForumRecord, forumWriteErrorMessage, getForumRecord } from '../forum-repo';
import { bindingAccess, bindingRkey, cacheBinding, cachedBinding, uncacheBinding, type BindingAccess, type ThreadBinding } from './bindings';
import { ExtensionCallError, dispatchAttach, hasHandler } from './host';
import { extensionsLockHeld } from './lock';
import { extensionsEnabled } from './manifest';
import { getInstall, type ExtensionInstall } from './registry';
import { BINDING_COLLECTION } from './scopes';

// Staff attach an extension to a thread. atmoBB writes the binding record
// itself, caches it, and only then hands the extension its setup. An extension
// that refuses the setup leaves nothing behind: the record and cache entry go.

export interface AttachRequest {
  installId: string;
  /** From the session. */
  viewerDid: string | null;
  /** The thread's at-uri. */
  thread: string;
  /** The setup the extension's attach form collected. */
  params: unknown;
}

export type AttachResult = { ok: true; binding: ThreadBinding; result: unknown } | { ok: false; status: number; message: string };

const refused = (status: number, message: string) => ({ ok: false as const, status, message });

const ACCESS_STATUS: Record<Exclude<BindingAccess, { ok: true }>['reason'], number> = {
  missing: 404,
  hidden: 403,
  elsewhere: 403,
  'members-only': 403,
  unavailable: 502,
};

export type AttachCheck = { ok: true; install: ExtensionInstall; viewerDid: string } | { ok: false; status: number; message: string };

/**
 * Whether staff may attach the install to the thread right now: everything
 * attachThread checks before writing anything, for the attach page to run
 * before it draws the extension's form.
 */
export async function checkAttach({ installId, viewerDid, thread }: Omit<AttachRequest, 'params'>): Promise<AttachCheck> {
  if (!viewerDid) return refused(401, 'Sign in as staff to attach an extension to a thread.');
  if (!(await canModerateForum(viewerDid))) return refused(403, 'Only staff who moderate the whole forum can attach extensions to threads.');
  if (!extensionsEnabled()) return refused(503, 'Extensions are turned off on this forum.');
  if (!extensionsLockHeld()) return refused(503, "Another copy of this forum's server is running extensions right now. Try again in a minute or two.");

  const install = await getInstall(installId);
  if (!install) return refused(404, 'No such extension is installed.');
  const { name } = install.manifest;
  if (install.state !== 'active') return refused(409, `${name} is disabled. Enable it before attaching it to a thread.`);

  const cached = await cachedBinding(thread);
  if (cached) {
    const attached = (await getInstall(cached.installId))?.manifest.name;
    return refused(409, attached ? `That thread already has ${attached} attached.` : 'That thread already has an extension attached.');
  }

  const access = await bindingAccess(thread);
  if (!access.ok) return refused(ACCESS_STATUS[access.reason], access.message);

  try {
    if (!(await hasHandler(installId, 'attach'))) return refused(422, `${name} can't be attached to a thread.`);
  } catch (error) {
    return refused(502, `${name} couldn't be loaded: ${callMessage(error)}`);
  }
  return { ok: true, install, viewerDid };
}

export async function attachThread(request: AttachRequest): Promise<AttachResult> {
  const check = await checkAttach(request);
  if (!check.ok) return check;
  const { installId, thread, params } = request;
  const { install, viewerDid } = check;
  const { name } = install.manifest;

  const rkey = bindingRkey(thread);
  const record = { $type: BINDING_COLLECTION, thread, extension: install.normalizedUrl, attachedBy: viewerDid, createdAt: new Date().toISOString() };
  let uri: string;
  try {
    // The cache skips a binding whose extension is no longer installed; the thread's key in the repo still holds it.
    if (await getForumRecord(BINDING_COLLECTION, rkey)) return refused(409, 'That thread already has an extension attached.');
    ({ uri } = await createForumRecordAsGiven(BINDING_COLLECTION, record, rkey));
  } catch (error) {
    return refused(502, forumWriteErrorMessage(error, "Couldn't save the thread's binding. Try again."));
  }

  const binding: ThreadBinding = { thread, installId, uri, extension: record.extension, attachedBy: viewerDid, createdAt: record.createdAt };
  try {
    await cacheBinding(binding);
    return { ok: true, binding, result: await dispatchAttach(installId, viewerDid, { uri: thread }, params) };
  } catch (error) {
    const leftover = (await undoBinding(binding)) ? '' : ' Its binding record could not be removed from the forum repo, so the thread may show it after a restart.';
    return refused(422, `${name} couldn't be attached: ${callMessage(error)}${leftover}`);
  }
}

/** Delete a binding's record and cache entry after a failed attach. False when the record couldn't be deleted. */
async function undoBinding(binding: ThreadBinding): Promise<boolean> {
  let removed = true;
  try {
    await deleteForumRecord(binding.uri);
  } catch (error) {
    removed = false;
    console.error(`[extensions] removing the binding record ${binding.uri} after a failed attach failed:`, error instanceof Error ? error.message : error);
  }
  await uncacheBinding(binding.thread).catch((error) =>
    console.error(`[extensions] removing the cached binding for ${binding.thread} failed:`, error instanceof Error ? error.message : error),
  );
  return removed;
}

/** Host errors carry no guest text, so their messages are safe to show; anything else stays generic. */
const callMessage = (error: unknown) => (error instanceof ExtensionCallError ? error.message : 'something went wrong on the server.');

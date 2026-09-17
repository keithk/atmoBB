import { posix } from 'node:path';
import { extensionPagePath, parseExtensionPagePath } from '$lib/extensions/page-path';
import { canModerateForum } from '../admin';
import { bindingAccess, bindingFor } from './bindings';
import { endorsementFor } from './endorsement';
import { hasHandler } from './host';
import { extensionsLockHeld } from './lock';
import { extensionsEnabled } from './manifest';
import { getInstall, listInstalls, type ExtensionInstall } from './registry';

// Where extension panels show up on the forum: on a thread staff bound an
// extension to, on the extension's own page, and on the staff attach page.

/** What a page needs to draw an install's panel. */
export interface PanelView {
  installId: string;
  name: string;
  /** The UI entry's path below the install's frame route. */
  entry: string;
  /** The extension's standalone page address, so a panel anywhere can link to it. */
  pageBase: string;
  /** Endorsed only when the directory reviewed the release this install runs. */
  endorsement?: 'endorsed' | 'unverified';
}

async function withEndorsement(install: ExtensionInstall, panel: PanelView | null): Promise<PanelView | null> {
  if (!panel) return null;
  const lookup = await endorsementFor(install.gitUrl, install.sha);
  return { ...panel, endorsement: lookup.status === 'endorsed' && lookup.reviewed ? 'endorsed' : 'unverified' };
}

export interface AttachLink {
  installId: string;
  name: string;
  href: string;
}

export interface ThreadExtension {
  panel: PanelView | null;
  /** For staff on an unbound thread: extensions they could attach. */
  attach: AttachLink[];
}

export const extensionsRunning = () => extensionsEnabled() && extensionsLockHeld();

/** The panel for an install, or null when it ships no UI. */
export function panelView(install: ExtensionInstall): PanelView | null {
  const entry = install.manifest.ui?.entry;
  if (!entry) return null;
  const dir = posix.dirname(entry);
  return {
    installId: install.id,
    name: install.manifest.name,
    entry: dir === '.' ? entry : entry.slice(dir.length + 1),
    pageBase: extensionPagePath(install.normalizedUrl),
  };
}

export interface ThreadExtensionRequest {
  thread: string;
  viewerDid: string | null;
  /** Whether the thread's board is public, as the forum's board index says. */
  boardPublic: boolean;
}

/**
 * The extension panel a thread shows, and for staff on an unbound thread on a
 * public board, the extensions they could attach. An unbound thread costs only
 * the local binding cache; a bound one also checks with the appview that the
 * thread is still visible on a public board. Null while extensions aren't running.
 */
export async function threadExtension({ thread, viewerDid, boardPublic }: ThreadExtensionRequest): Promise<ThreadExtension | null> {
  if (!extensionsRunning()) return null;
  const binding = await bindingFor(thread);
  if (binding) {
    const [access, install] = await Promise.all([bindingAccess(thread), getInstall(binding.installId)]);
    return { panel: access.ok && install ? await withEndorsement(install, panelView(install)) : null, attach: [] };
  }
  if (!viewerDid || !boardPublic || !(await canModerateForum(viewerDid))) return { panel: null, attach: [] };

  const candidates = (await listInstalls()).filter((install) => install.state === 'active' && panelView(install));
  const attachable = await Promise.all(candidates.map((install) => hasHandler(install.id, 'attach').catch(() => false)));
  return {
    panel: null,
    attach: candidates
      .filter((_, index) => attachable[index])
      .map((install) => ({ installId: install.id, name: install.manifest.name, href: `/x/${install.id}/attach?thread=${encodeURIComponent(thread)}` })),
  };
}

/**
 * The panel and page path an extension page address names, resolved to
 * whichever install of that repository is current. Null when the address
 * names no active install with a UI.
 */
export async function extensionPage(pathname: string): Promise<{ panel: PanelView; path: string } | null> {
  const parsed = parseExtensionPagePath(pathname);
  if (!parsed) return null;
  let repository: string;
  try {
    repository = new URL(parsed.repository).toString();
  } catch {
    return null;
  }
  const install = (await listInstalls()).find((entry) => entry.normalizedUrl === repository && entry.state === 'active');
  const panel = install ? await withEndorsement(install, panelView(install)) : null;
  return panel ? { panel, path: parsed.page } : null;
}

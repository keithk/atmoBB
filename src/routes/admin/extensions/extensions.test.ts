import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const state = vi.hoisted(() => ({
  env: {} as Record<string, string | undefined>,
  admin: vi.fn(),
  lockHeld: vi.fn(),
  openWork: vi.fn(),
  migrate: vi.fn(),
  refreshScopes: vi.fn(),
  extensionScope: vi.fn(),
  scopeStatus: vi.fn(),
  deleteRecord: vi.fn(),
  rebuildBindings: vi.fn(),
}));
vi.mock('$env/dynamic/private', () => ({ env: state.env }));
vi.mock('$lib/server/admin', () => ({ adminActor: state.admin }));
vi.mock('$lib/server/appview', () => ({ FORUM_DID: () => 'did:plc:forum' }));
vi.mock('$lib/server/forum-repo', () => ({ forumWriteMode: () => 'pds', deleteForumRecord: state.deleteRecord }));
vi.mock('$lib/server/atproto-oauth', () => ({ forumScopeStatus: state.scopeStatus }));
vi.mock('$lib/server/extensions/lock', () => ({ extensionsLockHeld: state.lockHeld }));
vi.mock('$lib/server/extensions/scopes', () => ({ refreshExtensionScopes: state.refreshScopes, extensionScope: state.extensionScope }));
vi.mock('$lib/server/extensions/bindings', () => ({ rebuildBindingsInBackground: state.rebuildBindings }));
vi.mock('$lib/server/extensions/host', () => ({
  openWork: state.openWork,
  migrate: state.migrate,
  extensionLog: () => [{ at: '2026-09-13T12:00:00.000Z', level: 'error', text: 'board failed to render' }],
}));
vi.mock('$lib/server/extensions/manifest', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/server/extensions/manifest')>()),
  // The real check looks the authority up in DNS; the fixture authority publishes nothing.
  checkPublishedLexicons: async (_authority: string, lexicons: { id: string }[]) => ({ status: 'unpublished', missing: lexicons.map((doc) => doc.id) }),
}));
import { startGitFixtures, validBundle, type GitFixtures } from '$lib/server/extensions/fixtures/git-server';
import { listClaims } from '$lib/server/extensions/claims';
import { getInstall, listInstalls } from '$lib/server/extensions/registry';
import * as index from './+page.server';
import * as detail from './[install]/+page.server';

const GAME = 'com.example.diplomacy.game';
const ORDER = 'com.example.diplomacy.order';
const INDEX = 'http://forum.test/admin/extensions';

let fixtures: GitFixtures;
let directory: string;
let repoCount = 0;
beforeAll(async () => {
  fixtures = await startGitFixtures();
});
afterAll(async () => {
  await fixtures.close();
});
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'atmobb-admin-extensions-test-'));
  vi.stubEnv('DATA_DIR', directory);
  vi.clearAllMocks();
  state.admin.mockResolvedValue('did:plc:admin');
  state.lockHeld.mockReturnValue(true);
  state.openWork.mockResolvedValue(false);
  state.migrate.mockResolvedValue(undefined);
  state.refreshScopes.mockResolvedValue(undefined);
  state.extensionScope.mockReturnValue('');
  state.scopeStatus.mockResolvedValue({ ok: true });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const key of Object.keys(state.env)) delete state.env[key];
  await rm(directory, { recursive: true, force: true });
});

const newRepo = () => fixtures.repo(`admin-extensions-${++repoCount}`);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Data = Record<string, any>;
const post = (url: string, values: Record<string, string> = {}, params: Record<string, string> = {}) =>
  ({ locals: {}, params, url: new URL(url), request: new Request(url, { method: 'POST', body: new URLSearchParams(values) }) }) as never;
const view = (url: string, params: Record<string, string> = {}) => ({ locals: {}, params, url: new URL(url) }) as never;
const detailUrl = (id: string) => `${INDEX}/${id}`;

const run = async (action: ((event: never) => unknown) | undefined, event: never) => (await action!(event)) as Data;
const loadIndex = async () => (await index.load(view(INDEX))) as Data;
const loadDetail = async (id: string) => (await detail.load(view(detailUrl(id), { install: id }))) as Data;

/** Stage and confirm through the page, returning the new install's id. */
async function installThroughPage(url: string, tag: string) {
  const staged = await run(index.actions.stage, post(INDEX, { gitUrl: url, tag }));
  const confirmed = await run(index.actions.confirm, post(INDEX, { stagingId: staged.review.stagingId }));
  return confirmed.installed.id as string;
}

const gameLexicon = (id: string) =>
  JSON.stringify({ lexicon: 1, id, defs: { main: { type: 'record', key: 'tid', record: { type: 'object', properties: { thread: { type: 'string' } } } } } });

/** A release that adds a second collection under the same authority. */
const withOrders = (version: string) =>
  validBundle({
    manifest: { version, collections: [GAME, ORDER], lexicons: ['lexicons/game.json', 'lexicons/order.json'] },
    dist: { lexicons: { 'game.json': gameLexicon(GAME), 'order.json': gameLexicon(ORDER) } },
  });

const stagingEntries = () => readdir(join(directory, 'extensions', '.staging')).catch(() => []);

it('refuses non-admins on both pages and every action', async () => {
  const repo = newRepo();
  repo.tag('v0.1.0', validBundle());
  state.admin.mockResolvedValue(null);
  await expect(index.load(view(INDEX))).rejects.toMatchObject({ status: 403 });
  await expect(detail.load(view(detailUrl('x'), { install: 'x' }))).rejects.toMatchObject({ status: 403 });
  const values = { gitUrl: repo.url, tag: 'v0.1.0', stagingId: 'A'.repeat(22), collection: GAME, really: 'on', force: 'on', sha: 'f'.repeat(40) };
  for (const action of [...Object.values(index.actions), ...Object.values(detail.actions)]) {
    expect(await action!(post(detailUrl('x'), values, { install: 'x' }))).toMatchObject({ status: 403, data: { message: 'Only admins can make this change.' } });
  }
  expect(await listInstalls()).toEqual([]);
  expect(await stagingEntries()).toEqual([]);
});

it('warns that an extension without the trusted mark is unverified, and still installs it', async () => {
  const repo = newRepo();
  repo.tag('v0.0.9', validBundle({ manifest: { version: '0.0.9' } }));
  const sha = repo.tag('v0.1.0', validBundle());
  repo.tag('v0.2.0-beta.1', validBundle({ manifest: { version: '0.2.0-beta.1' } }));

  // Leaving the tag blank picks the newest release that isn't a prerelease.
  const staged = await run(index.actions.stage, post(INDEX, { gitUrl: repo.url, tag: '' }));
  expect(staged.review).toMatchObject({
    name: 'Diplomacy',
    version: '0.1.0',
    tag: 'v0.1.0',
    sha,
    hostApi: '1.0',
    authority: 'com.example.diplomacy',
    collections: [GAME],
    capabilities: ['kv', 'records'],
    lexicons: { status: 'unpublished', missing: [GAME] },
    endorsement: null,
    unverified: true,
    changes: null,
  });
  expect(await listInstalls()).toEqual([]);
  expect(state.rebuildBindings).not.toHaveBeenCalled();

  const confirmed = await run(index.actions.confirm, post(INDEX, { stagingId: staged.review.stagingId }));
  expect(confirmed).toMatchObject({ installed: { name: 'Diplomacy' }, reconnect: { needed: false } });
  expect(state.refreshScopes).toHaveBeenCalledTimes(1);
  // A reinstalled repository gets a new install id, so thread bindings are re-mapped.
  expect(state.rebuildBindings).toHaveBeenCalledTimes(1);
  expect(await listInstalls()).toEqual([expect.objectContaining({ id: confirmed.installed.id, sha, state: 'active' })]);
  expect(await loadIndex()).toMatchObject({ unavailable: null, installs: [{ id: confirmed.installed.id, name: 'Diplomacy', version: '0.1.0' }] });
});

it("names the rejected field when admission refuses a manifest, and there's nothing to confirm", async () => {
  const repo = newRepo();
  repo.tag('v0.1.0', validBundle({ manifest: { capabilities: ['kv', 'filesystem'] } }));
  const refused = await run(index.actions.stage, post(INDEX, { gitUrl: repo.url, tag: 'v0.1.0' }));
  expect(refused).toMatchObject({ status: 400, data: { errors: [{ field: 'capabilities[1]', message: expect.stringMatching(/^capabilities\[1\]: unknown capability "filesystem"/) }] } });
  expect(refused.data).not.toHaveProperty('review');
  expect(await stagingEntries()).toEqual([]);

  expect(await run(index.actions.confirm, post(INDEX, { stagingId: 'A'.repeat(22) }))).toMatchObject({ status: 400, data: { errors: [{ field: 'stagingId' }] } });
  expect(await listInstalls()).toEqual([]);
  expect(await listClaims()).toEqual({});
});

it('shows a readable error for a bad git URL, a refused address, or a missing tag, and changes nothing', async () => {
  const repo = newRepo();
  repo.tag('v0.1.0', validBundle());
  const cases: [string, string, RegExp][] = [
    ['not a repository', 'v0.1.0', /not a repository URL/],
    ['not a repository', '', /not a URL/],
    [`http://git.test/${repo.name}.git`, 'v0.1.0', /must start with https:\/\//],
    ['https://127.0.0.1/diplomacy.git', 'v0.1.0', /Refused to connect to 127\.0\.0\.1/],
    [repo.url, 'v9.9.9', /no tag v9\.9\.9/],
    ['', '', /Enter the git URL/],
  ];
  for (const [gitUrl, tag, message] of cases) {
    const result = await run(index.actions.stage, post(INDEX, { gitUrl, tag }));
    expect(result, `${gitUrl} ${tag}`).toMatchObject({ status: 400, data: { fields: { gitUrl, tag }, errors: [{ message: expect.stringMatching(message) }] } });
  }

  const untagged = newRepo();
  untagged.tag('nightly', validBundle());
  expect(await run(index.actions.stage, post(INDEX, { gitUrl: untagged.url, tag: '' }))).toMatchObject({
    status: 400,
    data: { errors: [{ field: 'tag', message: expect.stringMatching(/no release tags/) }] },
  });

  expect(await listInstalls()).toEqual([]);
  expect(await stagingEntries()).toEqual([]);
});

it('asks for a reconnect when an update adds a collection the forum login lacks', async () => {
  const repo = newRepo();
  repo.tag('v0.1.0', validBundle());
  const id = await installThroughPage(repo.url, 'v0.1.0');
  const second = repo.tag('v0.2.0', withOrders('0.2.0'));

  expect(await loadDetail(id)).toMatchObject({ updates: { newer: [{ name: 'v0.2.0', sha: second }], changed: [] }, reconnect: { needed: false } });

  const staged = await run(detail.actions.stageUpdate, post(detailUrl(id), { tag: 'v0.2.0' }, { install: id }));
  expect(staged.review).toMatchObject({
    installId: id,
    sha: second,
    collections: [GAME, ORDER],
    changes: { version: { from: '0.1.0', to: '0.2.0' }, addedCollections: [ORDER], removedCollections: [], hostApi: null, dataVersion: null },
  });

  state.refreshScopes.mockClear();
  state.scopeStatus.mockResolvedValue({ ok: false, missing: [`repo:${ORDER}`] });
  const applied = await run(detail.actions.applyUpdate, post(detailUrl(id), { stagingId: staged.review.stagingId }, { install: id }));
  expect(applied).toMatchObject({ updated: { version: '0.2.0', tag: 'v0.2.0' }, reconnect: { needed: true, missing: [`repo:${ORDER}`] } });
  expect(state.migrate).toHaveBeenCalledWith(expect.objectContaining({ to: expect.objectContaining({ sha: second }) }));
  expect(state.refreshScopes.mock.invocationCallOrder[0]).toBeLessThan(state.scopeStatus.mock.invocationCallOrder.at(-1)!);
  expect(state.scopeStatus).toHaveBeenCalledWith('did:plc:forum');

  expect(await loadDetail(id)).toMatchObject({ reconnect: { needed: true, missing: [`repo:${ORDER}`] } });
  expect(await loadIndex()).toMatchObject({ reconnect: { needed: true, missing: [`repo:${ORDER}`] } });
  state.scopeStatus.mockResolvedValue({ ok: true });
  expect(await loadDetail(id)).toMatchObject({ reconnect: { needed: false } });
});

it('keeps the previous release active and shows the error when the migration fails', async () => {
  const repo = newRepo();
  const first = repo.tag('v0.1.0', validBundle());
  const id = await installThroughPage(repo.url, 'v0.1.0');
  repo.tag('v0.2.0', validBundle({ manifest: { version: '0.2.0', dataVersion: 2 } }));
  const staged = await run(detail.actions.stageUpdate, post(detailUrl(id), { tag: 'v0.2.0' }, { install: id }));
  expect(staged.review.changes).toMatchObject({ dataVersion: { from: 1, to: 2 } });

  state.migrate.mockRejectedValue(new Error('game state v1 cannot be read'));
  const failed = await run(detail.actions.applyUpdate, post(detailUrl(id), { stagingId: staged.review.stagingId }, { install: id }));
  expect(failed).toMatchObject({ status: 400, data: { errors: [{ field: 'migrate', message: expect.stringMatching(/v0\.1\.0 stays active: game state v1 cannot be read/) }] } });
  expect(await getInstall(id)).toMatchObject({ sha: first, tag: 'v0.1.0' });
  expect(await loadDetail(id)).toMatchObject({ install: { sha: first, version: '0.1.0' } });
});

it('refuses to uninstall with open work unless forced, and a forced uninstall keeps records and claims', async () => {
  const repo = newRepo();
  repo.tag('v0.1.0', validBundle());
  const id = await installThroughPage(repo.url, 'v0.1.0');
  state.openWork.mockResolvedValue(true);

  expect(await loadDetail(id)).toMatchObject({ openWork: { busy: true }, log: [{ text: 'board failed to render' }] });
  for (const action of [detail.actions.uninstall, detail.actions.disable]) {
    expect(await run(action, post(detailUrl(id), {}, { install: id }))).toMatchObject({
      status: 409,
      data: { openWork: true, errors: [{ field: 'openWork', message: expect.stringMatching(/Diplomacy reports work in progress/) }] },
    });
  }
  expect(await getInstall(id)).toMatchObject({ state: 'active' });

  state.refreshScopes.mockClear();
  await expect(detail.actions.uninstall!(post(detailUrl(id), { force: 'on' }, { install: id }))).rejects.toMatchObject({
    status: 303,
    location: '/admin/extensions?uninstalled=Diplomacy',
  });
  expect(state.refreshScopes).toHaveBeenCalledTimes(1);
  expect(await getInstall(id)).toBeNull();
  expect(state.deleteRecord).not.toHaveBeenCalled();
  expect(await listClaims()).toMatchObject({ [GAME]: { gitUrl: `https://git.test/${repo.name}` } });
  expect(await loadIndex()).toMatchObject({ installs: [], leftoverClaims: [{ collection: GAME, gitUrl: `https://git.test/${repo.name}` }] });

  // Releasing needs the confirmation box, then frees the collection.
  expect(await run(index.actions.releaseClaim, post(INDEX, { collection: GAME }))).toMatchObject({ status: 400 });
  expect(await run(index.actions.releaseClaim, post(INDEX, { collection: GAME, really: 'on' }))).toEqual({ released: GAME });
  expect(await listClaims()).toEqual({});
});

it("won't release a claim an installed extension still declares", async () => {
  const repo = newRepo();
  repo.tag('v0.1.0', validBundle());
  const id = await installThroughPage(repo.url, 'v0.1.0');
  expect(await loadDetail(id)).toMatchObject({ claims: [{ collection: GAME, declared: true }] });
  expect(await run(detail.actions.releaseClaim, post(detailUrl(id), { collection: GAME, really: 'on' }, { install: id }))).toMatchObject({
    status: 409,
    data: { message: expect.stringMatching(/Diplomacy still writes/) },
  });
  expect(Object.keys(await listClaims())).toEqual([GAME]);
});

it('refuses every change with a plain message when extensions are off or another server holds them', async () => {
  const repo = newRepo();
  repo.tag('v0.1.0', validBundle());
  const id = await installThroughPage(repo.url, 'v0.1.0');
  const values = { gitUrl: repo.url, tag: 'v0.1.0', stagingId: 'A'.repeat(22), collection: GAME, really: 'on', force: 'on', sha: 'f'.repeat(40) };
  const everyAction = [...Object.values(index.actions), ...Object.values(detail.actions)];

  state.env.ATMOBB_EXTENSIONS = 'off';
  expect(await loadIndex()).toMatchObject({ unavailable: expect.stringMatching(/turned off/) });
  expect(await loadDetail(id)).toMatchObject({ unavailable: expect.stringMatching(/turned off/), openWork: null });
  for (const action of everyAction) {
    expect(await action!(post(detailUrl(id), values, { install: id }))).toMatchObject({ status: 503, data: { message: expect.stringMatching(/turned off/) } });
  }

  delete state.env.ATMOBB_EXTENSIONS;
  state.lockHeld.mockReturnValue(false);
  expect(await loadIndex()).toMatchObject({ unavailable: expect.stringMatching(/another copy/i) });
  for (const action of everyAction) {
    expect(await action!(post(detailUrl(id), values, { install: id }))).toMatchObject({ status: 503, data: { message: expect.stringMatching(/another copy/i) } });
  }

  expect(await getInstall(id)).toMatchObject({ state: 'active' });
  expect(Object.keys(await listClaims())).toEqual([GAME]);
  expect(state.openWork).not.toHaveBeenCalled();
});

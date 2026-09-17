import { beforeEach, describe, expect, it, vi } from 'vitest';

// The trusted-mark admin page: only reachable on the atmobb.app directory
// forum (ATMOBB_EXTENSION_DIRECTORY=1), 404 everywhere else, and every action
// refuses a non-admin the same way the rest of /admin/extensions does —
// including with the directory env var set, per the review fix.

const state = vi.hoisted(() => ({
  env: {} as Record<string, string | undefined>,
  admin: vi.fn(),
  listEndorsements: vi.fn(),
  endorseRelease: vi.fn(),
  removeReviewedSha: vi.fn(),
}));
vi.mock('$env/dynamic/private', () => ({ env: state.env }));
vi.mock('$lib/server/admin', () => ({ adminActor: state.admin }));
vi.mock('$lib/server/extensions/endorsement', () => ({
  listEndorsements: state.listEndorsements,
  endorseRelease: state.endorseRelease,
  removeReviewedSha: state.removeReviewedSha,
}));
import { actions, load } from './+page.server';

const GIT_URL = 'https://github.com/jack/diplomacy';
const SHA = 'a'.repeat(40);

beforeEach(() => {
  for (const key of Object.keys(state.env)) delete state.env[key];
  vi.clearAllMocks();
  state.admin.mockResolvedValue('did:plc:staff');
  state.listEndorsements.mockResolvedValue([]);
});

const event = (values: Record<string, string> = {}) =>
  ({
    locals: {},
    request: new Request('http://directory.test/admin/extensions/endorse', { method: 'POST', body: new URLSearchParams(values) }),
  }) as never;
const view = () => ({ locals: {} }) as never;

describe('the page', () => {
  it('404s without ATMOBB_EXTENSION_DIRECTORY=1, even for an admin', async () => {
    await expect(load(view())).rejects.toMatchObject({ status: 404 });
    expect(state.listEndorsements).not.toHaveBeenCalled();
  });

  it('403s a non-admin before ever checking the directory flag', async () => {
    state.admin.mockResolvedValue(null);
    await expect(load(view())).rejects.toMatchObject({ status: 403 });
    expect(state.listEndorsements).not.toHaveBeenCalled();
  });

  it('lists endorsements once the directory flag is on', async () => {
    state.env.ATMOBB_EXTENSION_DIRECTORY = '1';
    state.listEndorsements.mockResolvedValue([{ uri: 'at://x/app.atmobb.extension.endorsement/1', gitUrl: GIT_URL, key: GIT_URL, reviewed: [SHA], createdAt: 't', updatedAt: 't' }]);
    expect(await load(view())).toEqual({ endorsements: [expect.objectContaining({ gitUrl: GIT_URL })] });
  });
});

describe('every action', () => {
  it('refuses a non-admin the same way other admin pages do, even with the directory flag on', async () => {
    state.env.ATMOBB_EXTENSION_DIRECTORY = '1';
    state.admin.mockResolvedValue(null);
    for (const action of Object.values(actions)) {
      expect(await action!(event({ gitUrl: GIT_URL, sha: SHA }))).toMatchObject({ status: 403, data: { message: 'Only admins can make this change.' } });
    }
    expect(state.endorseRelease).not.toHaveBeenCalled();
    expect(state.removeReviewedSha).not.toHaveBeenCalled();
  });

  it('404s an admin action when the directory flag is off', async () => {
    for (const action of Object.values(actions)) {
      await expect(action!(event({ gitUrl: GIT_URL, sha: SHA }))).rejects.toMatchObject({ status: 404 });
    }
  });
});

describe('endorse', () => {
  beforeEach(() => {
    state.env.ATMOBB_EXTENSION_DIRECTORY = '1';
  });

  it('refuses a missing git URL, an invalid one, and a malformed SHA, without writing anything', async () => {
    expect(await actions.endorse!(event({ gitUrl: '', sha: SHA }))).toMatchObject({ status: 400, data: { message: expect.stringMatching(/git URL/) } });
    expect(await actions.endorse!(event({ gitUrl: 'not a url', sha: SHA }))).toMatchObject({ status: 400, data: { message: expect.stringMatching(/not a valid git URL/) } });
    expect(await actions.endorse!(event({ gitUrl: GIT_URL, sha: 'nothex!' }))).toMatchObject({ status: 400, data: { message: expect.stringMatching(/SHA/) } });
    expect(await actions.endorse!(event({ gitUrl: GIT_URL, sha: SHA, listing: 'not-an-at-uri' }))).toMatchObject({ status: 400, data: { message: expect.stringMatching(/at:\/\//) } });
    expect(state.endorseRelease).not.toHaveBeenCalled();
  });

  it('lowercases the SHA and forwards the listing thread when given', async () => {
    state.endorseRelease.mockResolvedValue({ uri: 'at://x/1', gitUrl: GIT_URL, key: GIT_URL, reviewed: [SHA], createdAt: 't', updatedAt: 't' });
    const listing = 'at://did:plc:x/app.atmobb.discussion.thread/3k';
    const result = await actions.endorse!(event({ gitUrl: GIT_URL, sha: SHA.toUpperCase(), listing }));
    expect(state.endorseRelease).toHaveBeenCalledWith(GIT_URL, SHA, listing);
    expect(result).toEqual({ saved: GIT_URL });
  });

  it('reports a write failure without throwing', async () => {
    state.endorseRelease.mockRejectedValue(new Error("the forum's PDS refused the write"));
    expect(await actions.endorse!(event({ gitUrl: GIT_URL, sha: SHA }))).toMatchObject({ status: 502, data: { message: expect.stringContaining('refused the write') } });
  });
});

describe('removeSha', () => {
  beforeEach(() => {
    state.env.ATMOBB_EXTENSION_DIRECTORY = '1';
  });

  it('removes a reviewed sha and reports success', async () => {
    state.removeReviewedSha.mockResolvedValue({ uri: 'at://x/1', gitUrl: GIT_URL, key: GIT_URL, reviewed: [], createdAt: 't', updatedAt: 't' });
    const result = await actions.removeSha!(event({ gitUrl: GIT_URL, sha: SHA }));
    expect(state.removeReviewedSha).toHaveBeenCalledWith(GIT_URL, SHA);
    expect(result).toEqual({ removed: { gitUrl: GIT_URL, sha: SHA } });
  });

  it('404s removing a SHA from a repository with no endorsement', async () => {
    state.removeReviewedSha.mockResolvedValue(null);
    expect(await actions.removeSha!(event({ gitUrl: GIT_URL, sha: SHA }))).toMatchObject({ status: 404 });
  });
});

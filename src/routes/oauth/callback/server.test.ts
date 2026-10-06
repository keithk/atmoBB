import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import type { Cookies, RequestEvent } from '@sveltejs/kit';

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(), callback: vi.fn(), revoke: vi.fn(),
  refresh: vi.fn(), list: vi.fn(), create: vi.fn(), invalidate: vi.fn(),
}));
vi.mock('$env/dynamic/private', () => ({ env: { ATMOBB_COOKIE_SECRET: 'synthetic-cookie-secret' } }));
vi.mock('$lib/server/atproto-oauth', () => ({
  MEMBER_SCOPE: 'atproto member', sysopScope: () => 'atproto forum repo:extension.collection',
  oauthClient: () => ({ authorize: mocks.authorize, callback: mocks.callback, revoke: mocks.revoke }),
}));
vi.mock('$lib/server/extensions/scopes', () => ({ refreshExtensionScopes: mocks.refresh }));
vi.mock('$lib/server/appview', () => ({ FORUM_DID: () => 'did:plc:forum', resolveHandle: vi.fn() }));
vi.mock('$lib/server/admin', () => ({ invalidateForumSession: mocks.invalidate, invalidateStaff: mocks.invalidate }));
vi.mock('@atproto/api', () => ({
  Agent: class { com = { atproto: { repo: { listRecords: mocks.list, createRecord: mocks.create } } }; },
}));
import { actions as login } from '../../login/+page.server';
import { actions as connect } from '../../admin/connect/+page.server';
import { GET } from './+server';
import { APP_COOKIE, sessionDid, setSessionCookie } from '$lib/server/session';
import { OAuthConfigurationError } from '$lib/server/happyview-oauth';

function browser() {
  const values = new Map<string, string>();
  return {
    get: vi.fn((name: string) => values.get(name)),
    set: vi.fn((name: string, value: string) => { values.set(name, value); }),
    delete: vi.fn((name: string) => { values.delete(name); }),
  } as unknown as Cookies;
}

function event(cookies = browser(), fields: Record<string, string> = {}) {
  return {
    cookies,
    request: new Request('https://forum.test/login', { method: 'POST', body: new URLSearchParams(fields) }),
    url: new URL('https://forum.test/oauth/callback?state=opaque&code=secret-code&iss=https://as.test'),
    locals: { user: null },
  } as unknown as RequestEvent;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue(new URL('https://as.test/authorize'));
  mocks.list.mockResolvedValue({ data: { records: [] } });
  mocks.create.mockResolvedValue({});
});

describe('login and forum connect routes', () => {
  it('keeps member consent narrow, carries safe return context separately, and binds cookies', async () => {
    const e = event(browser(), { handle: ' @member.test ', next: '/notifications' });
    await expect(login.login!(e as never)).rejects.toMatchObject({ status: 303, location: 'https://as.test/authorize' });
    expect(mocks.authorize).toHaveBeenCalledWith('member.test', {
      scope: 'atproto member', cookies: e.cookies, context: { purpose: 'member', next: '/notifications' },
    });
  });

  it('does not pass external return URLs or business values as OAuth state', async () => {
    await expect(login.login!(event(browser(), { handle: 'member.test', next: '//attacker.test' }) as never)).rejects.toMatchObject({ status: 303 });
    expect(mocks.authorize.mock.calls[0][1]).toMatchObject({ context: { purpose: 'member' } });
    expect(mocks.authorize.mock.calls[0][1]).not.toHaveProperty('state');
    expect(mocks.authorize.mock.calls[0][1].context).not.toHaveProperty('next');
  });

  it('requires a personal login before forum consent', async () => {
    await expect(connect.connect!(event(browser(), { handle: 'forum.test' }) as never)).rejects.toMatchObject({ status: 303, location: '/login' });
    expect(mocks.authorize).not.toHaveBeenCalled();
  });

  it('reports safe configuration failures but not SDK response bodies', async () => {
    mocks.authorize.mockRejectedValueOnce(new OAuthConfigurationError('Configure HAPPYVIEW_CLIENT_KEY.'));
    expect(await login.login!(event(browser(), { handle: 'member.test' }) as never)).toMatchObject({
      status: 502, data: { message: 'Configure HAPPYVIEW_CLIENT_KEY.' },
    });
    mocks.authorize.mockRejectedValueOnce(new Error('upstream private response'));
    expect(await login.login!(event(browser(), { handle: 'member.test' }) as never)).toMatchObject({
      status: 502, data: { message: 'Login failed. Check your handle and try again.' },
    });
  });

  it('requests refreshed extension grants only for forum context and records the connector', async () => {
    const e = event(browser(), { handle: 'forum.test' });
    e.locals.user = { did: 'did:plc:member', handle: 'member.test' };
    await expect(connect.connect!(e as never)).rejects.toMatchObject({ status: 303 });
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.authorize).toHaveBeenCalledWith('forum.test', {
      scope: 'atproto forum repo:extension.collection', cookies: e.cookies,
      context: { purpose: 'forum', connector: 'did:plc:member', forumDid: 'did:plc:forum' },
    });
  });
});

describe('callback effects', () => {
  it('sets only a new-generation personal login cookie and uses the safe return path', async () => {
    const e = event();
    mocks.callback.mockResolvedValue({ session: { did: 'did:plc:member' }, context: { purpose: 'member', next: '/notifications' } });
    await expect(GET(e as never)).rejects.toMatchObject({ status: 303, location: '/notifications' });
    expect(sessionDid(e.cookies)).toBe('did:plc:member');
    expect(e.cookies.set).toHaveBeenCalledWith(APP_COOKIE, expect.any(String), expect.objectContaining({ httpOnly: true }));
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('keeps forum consent separate from browser identity and grants only its initiating user', async () => {
    const e = event();
    setSessionCookie(e.cookies, 'did:plc:member');
    vi.mocked(e.cookies.set).mockClear();
    mocks.callback.mockResolvedValue({ session: { did: 'did:plc:forum' },
      context: { purpose: 'forum', connector: 'did:plc:member', forumDid: 'did:plc:forum' } });
    await expect(GET(e as never)).rejects.toMatchObject({ status: 303, location: '/admin?connected=1' });
    expect(mocks.callback).toHaveBeenCalledWith(e.url.searchParams, e.cookies, 'did:plc:member');
    expect(e.cookies.set).not.toHaveBeenCalled();
    expect(sessionDid(e.cookies)).toBe('did:plc:member');
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      repo: 'did:plc:forum', record: expect.objectContaining({ subject: 'did:plc:member', role: 'admin' }),
    }));
  });

  it('does not duplicate an existing moderator grant', async () => {
    const e = event();
    setSessionCookie(e.cookies, 'did:plc:member');
    mocks.list.mockResolvedValue({ data: { records: [{ value: { subject: 'did:plc:member' } }] } });
    mocks.callback.mockResolvedValue({ session: { did: 'did:plc:forum' },
      context: { purpose: 'forum', connector: 'did:plc:member', forumDid: 'did:plc:forum' } });
    await expect(GET(e as never)).rejects.toMatchObject({ status: 303 });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('rejects failed verification without granting, revoking another account, or exposing secrets', async () => {
    const e = event();
    mocks.callback.mockRejectedValue(new Error('upstream secret-code token response'));
    await expect(GET(e as never)).rejects.toMatchObject({
      status: 400, body: { message: 'Login could not be verified. Return to login or forum connect and start again.' },
    });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.revoke).not.toHaveBeenCalled();
    expect(e.cookies.set).not.toHaveBeenCalled();
  });

  it('defensively rejects changed forum or connector context before granting', async () => {
    const e = event();
    setSessionCookie(e.cookies, 'did:plc:other');
    mocks.callback.mockResolvedValue({ session: { did: 'did:plc:forum' },
      context: { purpose: 'forum', connector: 'did:plc:member', forumDid: 'did:plc:forum' } });
    await expect(GET(e as never)).rejects.toMatchObject({ status: 400 });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('does not recognize old direct-PDS authentication cookies', () => {
    const cookies = browser();
    const did = 'did:plc:member';
    const mac = createHmac('sha256', 'synthetic-cookie-secret').update(did).digest('base64url');
    cookies.set('atmobb_session', `${did}.${mac}`, { path: '/' });
    expect(sessionDid(cookies)).toBeNull();
    cookies.set(APP_COOKIE, `${did}.${mac}`, { path: '/' });
    expect(sessionDid(cookies)).toBeNull();
    setSessionCookie(cookies, did);
    expect(sessionDid(cookies)).toBe(did);
  });
});

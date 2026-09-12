import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canRetryTurnOn,
  enableNotifications,
  recheckPending,
  resetOptInForTests,
  type OptInDeps,
} from './optin';
import type { MemberNotifyState } from './store';

const did = 'did:plc:alice';
const NOW = Date.parse('2026-09-12T12:00:00Z');
const minutesAgo = (n: number) => new Date(NOW - n * 60_000).toISOString();

const member = (status: MemberNotifyState['status'], changedAt = minutesAgo(0)): MemberNotifyState => ({
  status,
  changedAt,
  promptDismissed: false,
  entries: [],
});

const details = { forumName: 'x'.repeat(60), description: 'Replies and mentions.', iconUrl: 'https://forum.test/icon.png' };

function fakeDeps(overrides: Partial<OptInDeps> = {}): OptInDeps {
  return {
    senderDid: 'did:web:forum.test',
    getServiceAuth: vi.fn(async () => 'user-token'),
    requestPermission: vi.fn(async () => ({ status: 'pending' as const })),
    store: {
      readMember: vi.fn(async () => null),
      setStatus: vi.fn(async () => {}),
      confirmPending: vi.fn(async () => {}),
    },
    ...overrides,
  };
}

beforeEach(() => {
  resetOptInForTests();
});

describe('canRetryTurnOn', () => {
  it('allows when there is no state file or the member is not pending', () => {
    expect(canRetryTurnOn(null, NOW)).toBe(true);
    expect(canRetryTurnOn(member('off'), NOW)).toBe(true);
    expect(canRetryTurnOn(member('on'), NOW)).toBe(true);
  });

  it('blocks a pending member for ten minutes after changedAt', () => {
    expect(canRetryTurnOn(member('pending', minutesAgo(5)), NOW)).toBe(false);
    expect(canRetryTurnOn(member('pending', minutesAgo(11)), NOW)).toBe(true);
  });
});

describe('enableNotifications', () => {
  it('marks pending, mints a token, and confirms pending when the relay says pending', async () => {
    const deps = fakeDeps();
    const result = await enableNotifications({ did, ...details, deps });
    expect(result).toEqual({ outcome: 'pending' });
    expect(deps.store.setStatus).toHaveBeenCalledWith(did, 'pending');
    expect(deps.getServiceAuth).toHaveBeenCalledWith(did);
    expect(deps.requestPermission).toHaveBeenCalledWith('user-token', {
      senderDid: 'did:web:forum.test',
      title: 'x'.repeat(50),
      description: details.description,
      iconUrl: details.iconUrl,
    });
    expect(deps.store.confirmPending).toHaveBeenCalledWith(did);
  });

  it('flips straight to on when the relay says alreadyGranted', async () => {
    const deps = fakeDeps({ requestPermission: vi.fn(async () => ({ status: 'alreadyGranted' as const })) });
    expect(await enableNotifications({ did, ...details, deps })).toEqual({ outcome: 'on' });
    expect(deps.store.setStatus).toHaveBeenLastCalledWith(did, 'on');
    expect(deps.store.confirmPending).not.toHaveBeenCalled();
  });

  it('asks for re-consent on a scope or permission refusal and goes back to off', async () => {
    for (const err of [
      Object.assign(new Error('Bad token scope'), { error: 'InvalidToken' }),
      new Error('missing permission for lxm'),
      new Error('Not authorized'),
    ]) {
      const deps = fakeDeps({ getServiceAuth: vi.fn(async () => { throw err; }) });
      expect(await enableNotifications({ did, ...details, deps })).toEqual({ outcome: 'reconsent' });
      expect(deps.store.setStatus).toHaveBeenLastCalledWith(did, 'off');
      expect(deps.requestPermission).not.toHaveBeenCalled();
    }
  });

  it('treats any other token failure as transient and stays off', async () => {
    const deps = fakeDeps({ getServiceAuth: vi.fn(async () => { throw new Error('fetch failed'); }) });
    expect(await enableNotifications({ did, ...details, deps })).toEqual({
      outcome: 'pds-error',
      message: "Couldn't reach your account's server. Try again.",
    });
    expect(deps.store.setStatus).toHaveBeenLastCalledWith(did, 'off');
  });

  it('reports a relay failure and stays off', async () => {
    const deps = fakeDeps({ requestPermission: vi.fn(async () => ({ error: 'RateLimited', status: 429 })) });
    expect(await enableNotifications({ did, ...details, deps })).toEqual({
      outcome: 'relay-error',
      message: "atmo.pub didn't answer. Try again in a minute.",
    });
    expect(deps.store.setStatus).toHaveBeenLastCalledWith(did, 'off');
  });

  it('leaves the icon out when it is not https', async () => {
    const deps = fakeDeps();
    await enableNotifications({ did, ...details, iconUrl: 'http://forum.test/icon.png', deps });
    expect(vi.mocked(deps.requestPermission).mock.calls[0][1].iconUrl).toBeUndefined();
  });
});

describe('recheckPending', () => {
  it('does nothing unless the member is pending', async () => {
    const deps = fakeDeps({ store: { ...fakeDeps().store, readMember: vi.fn(async () => member('off')) } });
    await recheckPending({ did, ...details, deps, nowMs: NOW });
    expect(deps.getServiceAuth).not.toHaveBeenCalled();
  });

  it('flips a pending member on when the relay says alreadyGranted', async () => {
    const deps = fakeDeps({
      store: { ...fakeDeps().store, readMember: vi.fn(async () => member('pending')) },
      requestPermission: vi.fn(async () => ({ status: 'alreadyGranted' as const })),
    });
    await recheckPending({ did, ...details, deps, nowMs: NOW });
    expect(deps.store.setStatus).toHaveBeenCalledWith(did, 'on');
  });

  it('leaves pending alone on pending or on any error', async () => {
    const pending = () => ({ ...fakeDeps().store, readMember: vi.fn(async () => member('pending')) });
    const still = fakeDeps({ store: pending() });
    await recheckPending({ did, ...details, deps: still, nowMs: NOW });
    expect(still.store.setStatus).not.toHaveBeenCalled();
    expect(still.store.confirmPending).not.toHaveBeenCalled();

    const broken = fakeDeps({ store: pending(), getServiceAuth: vi.fn(async () => { throw new Error('boom'); }) });
    await expect(recheckPending({ did, ...details, deps: broken, nowMs: NOW })).resolves.toBeUndefined();
    expect(broken.store.setStatus).not.toHaveBeenCalled();
  });

  it('asks the relay at most once a minute per member', async () => {
    const deps = fakeDeps({ store: { ...fakeDeps().store, readMember: vi.fn(async () => member('pending')) } });
    await recheckPending({ did, ...details, deps, nowMs: NOW });
    await recheckPending({ did, ...details, deps, nowMs: NOW + 30_000 });
    expect(deps.requestPermission).toHaveBeenCalledTimes(1);
    await recheckPending({ did, ...details, deps, nowMs: NOW + 61_000 });
    expect(deps.requestPermission).toHaveBeenCalledTimes(2);
    // Another member has their own clock.
    await recheckPending({ did: 'did:plc:bob', ...details, deps, nowMs: NOW + 61_000 });
    expect(deps.requestPermission).toHaveBeenCalledTimes(3);
  });
});

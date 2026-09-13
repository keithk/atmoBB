import { describe, expect, it } from 'vitest';
import { safeReturnPath } from './return-path';

describe('safeReturnPath', () => {
  it('accepts the notifications settings page, with or without the reconsent flag', () => {
    expect(safeReturnPath('/settings/notifications')).toBe('/settings/notifications');
    expect(safeReturnPath('/settings/notifications?reconsented=1')).toBe('/settings/notifications?reconsented=1');
  });

  it('accepts public and members-only thread paths', () => {
    expect(safeReturnPath('/t/did:plc:x/abc')).toBe('/t/did:plc:x/abc');
    expect(safeReturnPath('/b/general/t/did:plc:x/3kabc')).toBe('/b/general/t/did:plc:x/3kabc');
    expect(safeReturnPath('/b/did:web:other.forum/general/t/did:plc:x/3kabc')).toBe(
      '/b/did:web:other.forum/general/t/did:plc:x/3kabc',
    );
  });

  it('accepts the notifications page and open links, with or without the alert marker', () => {
    const id = '0f9a1b2c-3d4e-4f60-8a71-92b3c4d5e6f7';
    expect(safeReturnPath('/notifications')).toBe('/notifications');
    expect(safeReturnPath(`/notifications/open/${id}`)).toBe(`/notifications/open/${id}`);
    expect(safeReturnPath(`/notifications/open/${id}?via=notify`)).toBe(`/notifications/open/${id}?via=notify`);
  });

  it('rejects notification paths that stray from those shapes', () => {
    expect(safeReturnPath('/notifications/open/../x')).toBeNull();
    expect(safeReturnPath('/notifications/open/0f9a1b2c-3d4e-4f60-8a71-92b3c4d5e6f7?via=other')).toBeNull();
    expect(safeReturnPath('/notificationsx')).toBeNull();
  });

  it('accepts an invite link and nothing shaped almost like one', () => {
    const token = 'abcdefghijklmnopqrstuvwxyz'.slice(0, 26);
    expect(safeReturnPath(`/join/${token}`)).toBe(`/join/${token}`);
    expect(safeReturnPath(`/join/${token}?x=1`)).toBeNull();
    expect(safeReturnPath(`/join/${token.slice(0, 25)}`)).toBeNull();
    expect(safeReturnPath('/join/ABCDEFGHIJKLMNOPQRSTUVWXYZ')).toBeNull();
    expect(safeReturnPath('/join/abcdefghijklmnopqrstuvwxy1')).toBeNull();
    expect(safeReturnPath('/join')).toBeNull();
  });

  it('accepts the pages the join notice returns to', () => {
    expect(safeReturnPath('/')).toBe('/');
    expect(safeReturnPath('/latest')).toBe('/latest');
    expect(safeReturnPath('/apply')).toBe('/apply');
    expect(safeReturnPath('/b/general')).toBe('/b/general');
    expect(safeReturnPath('/b/did:plc:abc/general?page=2')).toBe('/b/did:plc:abc/general?page=2');
    expect(safeReturnPath('/b/general?page=x')).toBeNull();
    expect(safeReturnPath('/b/general/extra')).toBeNull();
  });

  it('rejects protocol-relative, backslash, absolute, and off-list paths', () => {
    expect(safeReturnPath('//evil.example')).toBeNull();
    expect(safeReturnPath('/\\evil')).toBeNull();
    expect(safeReturnPath('https://evil.example')).toBeNull();
    expect(safeReturnPath('/admin')).toBeNull();
    expect(safeReturnPath('/settings/notifications?x=1')).toBeNull();
    expect(safeReturnPath('/t/did:plc:x/abc?edit=abc')).toBeNull();
    expect(safeReturnPath('settings/notifications')).toBeNull();
  });

  it('rejects non-strings and empty values', () => {
    expect(safeReturnPath(null)).toBeNull();
    expect(safeReturnPath(undefined)).toBeNull();
    expect(safeReturnPath('')).toBeNull();
    expect(safeReturnPath(42)).toBeNull();
  });
});

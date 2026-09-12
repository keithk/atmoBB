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

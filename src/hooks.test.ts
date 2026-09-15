import { describe, expect, it } from 'vitest';
import { reroute } from './hooks';

const route = (pathname: string) =>
  reroute({ url: new URL(pathname, 'https://forum.test'), fetch: globalThis.fetch });

describe('thread URL rerouting', () => {
  it('routes readable thread URLs by their stable DID and record key', () => {
    expect(route('/t/general-chat/what-is-new/did:plc:alice/3kaaa')).toBe(
      '/t/did:plc:alice/3kaaa',
    );
  });

  it('keeps social cards and reply permalinks working below readable URLs', () => {
    expect(route('/t/general/hello/did:plc:alice/3kaaa/og.png')).toBe(
      '/t/did:plc:alice/3kaaa/og.png',
    );
    expect(route('/t/general/hello/did:plc:alice/3kaaa/p/did:plc:bob/3kbbb')).toBe(
      '/t/did:plc:alice/3kaaa/p/did:plc:bob/3kbbb',
    );
  });

  it('does not reinterpret legacy or unrelated paths', () => {
    expect(route('/t/did:plc:alice/3kaaa')).toBeUndefined();
    expect(route('/members/alice.test')).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { reroute } from './hooks';

const route = (pathname: string) =>
  reroute({ url: new URL(pathname, 'https://forum.test'), fetch: globalThis.fetch });

describe('thread URL rerouting', () => {
  for (const prefix of ['/t/hello', '/t/general/hello']) {
    it(`routes ${prefix} by stable identity, including cards and replies`, () => {
      const base = `${prefix}/did:plc:alice/3kaaa`;
      const target = '/t/did:plc:alice/3kaaa';
      expect(route(base)).toBe(target);
      expect(route(`${base}/og.png`)).toBe(`${target}/og.png`);
      expect(route(`${base}/p/did:plc:bob/3kbbb`)).toBe(`${target}/p/did:plc:bob/3kbbb`);
    });
  }

  it('leaves bare and unrelated paths alone', () => {
    expect(route('/t/did:plc:alice/3kaaa')).toBeUndefined();
    expect(route('/t/did:plc:alice/3kaaa/p/did:plc:bob/3kbbb')).toBeUndefined();
    expect(route('/t/hello/did:plc:alice')).toBeUndefined();
    expect(route('/members/alice.test')).toBeUndefined();
  });
});

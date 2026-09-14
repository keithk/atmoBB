import { describe, expect, it } from 'vitest';
import { extensionLinkHref, extensionPagePath, parseExtensionPagePath } from './page-path';

describe('extension page paths', () => {
  it('names a repository by its host and path, readably', () => {
    expect(extensionPagePath('https://git.example/jack/diplomacy')).toBe('/ext/git.example/jack/diplomacy');
    expect(extensionPagePath('https://git.example/jack/diplomacy', 'games/spring-1901')).toBe('/ext/git.example/jack/diplomacy/-/games/spring-1901');
    expect(extensionPagePath('https://git.sr.ht/~jack/diplomacy')).toBe('/ext/git.sr.ht/~jack/diplomacy');
  });

  it('reverses to the repository and the page inside it', () => {
    for (const [repository, page] of [
      ['https://git.example/jack/diplomacy', ''],
      ['https://git.example/jack/diplomacy', 'games/spring-1901'],
      ['https://git.example:8443/jack/diplomacy', 'replay'],
      ['https://git.sr.ht/~jack/diplomacy', ''],
      ['https://git.example/jack/-/weird/--', 'a/-/b'],
      ['file:///Users/jack/code/diplomacy', 'x'],
    ]) {
      expect(parseExtensionPagePath(extensionPagePath(repository, page)), `${repository} ${page}`).toEqual({ repository, page });
    }
  });

  it('keeps a repository path segment made only of hyphens apart from the page separator', () => {
    expect(extensionPagePath('https://git.example/jack/-', 'p')).toBe('/ext/git.example/jack/--/-/p');
  });

  it('gives the page decoded', () => {
    expect(parseExtensionPagePath('/ext/git.example/jack/diplomacy/-/games/fall%201901')).toEqual({
      repository: 'https://git.example/jack/diplomacy',
      page: 'games/fall 1901',
    });
  });

  it('refuses paths that do not name a repository', () => {
    for (const path of ['/ext', '/ext/', '/ext/-/page', '/elsewhere/git.example/x', '/ext/https~git.example/x', '/ext/Bad Scheme~host/x', '/ext/git.example/x/-/%E0%A4%A']) {
      expect(parseExtensionPagePath(path), path).toBeNull();
    }
  });
});

describe('extensionLinkHref', () => {
  const pageBase = extensionPagePath('https://git.example/jack/diplomacy');

  it('builds the href for a page under the pageBase', () => {
    expect(extensionLinkHref(pageBase, 'games/spring-1901')).toBe('/ext/git.example/jack/diplomacy/-/games/spring-1901');
  });

  it('rebuilds through the repository rather than trusting the pageBase string, landing at the same place', () => {
    const weirdBase = extensionPagePath('https://git.example/jack/-');
    expect(extensionLinkHref(weirdBase, 'p')).toBe('/ext/git.example/jack/--/-/p');
  });

  it('returns null when the pageBase names no repository', () => {
    expect(extensionLinkHref('/not-an-ext-path', 'games')).toBeNull();
  });

  it('returns null for a page that would not land under this pageBase', () => {
    expect(extensionLinkHref(pageBase, '')).toBeNull();
  });
});

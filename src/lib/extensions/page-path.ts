// An extension's standalone page has an address keyed by its repository, not
// its install id, so a shared link keeps working after the extension is
// reinstalled. The repository's host and path read as they do in the git URL:
//
//   https://git.example/jack/diplomacy  ->  /ext/git.example/jack/diplomacy
//   ... and a page inside it            ->  /ext/git.example/jack/diplomacy/-/games/spring-1901
//
// A lone `-` segment separates the repository from the page, so a repository
// segment made only of hyphens gets one more on the way in and loses it on the
// way out. https is implied; any other scheme leads the host as `scheme~host`,
// which no hostname can contain.

const PREFIX = '/ext/';
const SCHEME = /^[a-z][a-z0-9+.-]*$/;
const HYPHENS = /^-+$/;

/** The standalone page address for a normalized repository URL, optionally at a page inside it. */
export function extensionPagePath(repository: string, page = ''): string {
  const url = new URL(repository);
  const scheme = url.protocol.slice(0, -1);
  const first = scheme === 'https' ? url.host : `${scheme}~${url.host}`;
  const segments = url.pathname === '/' ? [] : url.pathname.slice(1).split('/');
  const path = [first, ...segments.map((segment) => (HYPHENS.test(segment) ? `-${segment}` : segment))].join('/');
  const inner = page.replace(/^\/+/, '');
  return `${PREFIX}${path}${inner ? `/-/${inner}` : ''}`;
}

/** The repository URL and decoded page an address names, or null when it names none. */
export function parseExtensionPagePath(pathname: string): { repository: string; page: string } | null {
  if (!pathname.startsWith(PREFIX)) return null;
  const segments = pathname.slice(PREFIX.length).split('/');
  const separator = segments.indexOf('-');
  const repositorySegments = separator === -1 ? segments : segments.slice(0, separator);
  const [first, ...rest] = repositorySegments;
  if (!first) return null;

  const tilde = first.indexOf('~');
  const scheme = tilde === -1 ? 'https' : first.slice(0, tilde);
  const host = tilde === -1 ? first : first.slice(tilde + 1);
  if (!SCHEME.test(scheme) || (tilde !== -1 && scheme === 'https')) return null;

  const path = rest.map((segment) => (HYPHENS.test(segment) ? segment.slice(1) : segment)).join('/');
  let page: string;
  try {
    page = separator === -1 ? '' : segments.slice(separator + 1).map(decodeURIComponent).join('/');
  } catch {
    return null;
  }
  return { repository: `${scheme}://${host}${rest.length ? `/${path}` : ''}`, page };
}

/**
 * The href for a page a panel names inside its own standalone pages, given
 * its install's `pageBase` (as sent in the bridge's `init` message) and a
 * `page` from a bridge `link` message. Rebuilds the address from `pageBase`'s
 * own repository rather than trusting string concatenation, and refuses
 * anything that doesn't land back under `pageBase`'s `/-/` — the same
 * boundary a shared link has to stay inside after a reinstall.
 */
export function extensionLinkHref(pageBase: string, page: string): string | null {
  const parsed = parseExtensionPagePath(pageBase);
  if (!parsed) return null;
  const href = extensionPagePath(parsed.repository, page);
  // Compare resolved paths, not raw strings: a browser collapses percent-encoded
  // dot segments (like `%2e%2e`) the same way it collapses literal ones, so the
  // containment check has to see the address the same way the browser will.
  const base = new URL(pageBase, 'https://forum.invalid').pathname;
  const resolved = new URL(href, 'https://forum.invalid').pathname;
  return resolved.startsWith(`${base}/-/`) ? href : null;
}

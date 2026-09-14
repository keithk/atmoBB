import { lstat, readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { env } from '$env/dynamic/private';
import { extensionsLockHeld } from './lock';
import { extensionsEnabled } from './manifest';
import { bundleDir, getInstall } from './registry';

// Serves an extension's UI files to its sandboxed panel frame. Each file type
// goes only to the request destination that loads it that way: the UI entry
// only into an iframe, scripts only as scripts, and so on. Opening a frame URL
// as a page, embedding it as an object, or starting a worker from it is
// refused, and so is any request that doesn't say what loads it. Every
// response, refusals included, carries a policy that sandboxes the document,
// allows scripts and styles only from this install's frame directory, and
// allows no network access. Nothing here reads or sets cookies.

const INSTALL_ID = /^[A-Za-z0-9_-]{22}$/;
const SEGMENT = /^[A-Za-z0-9._-]+$/;

/** Whether a request path, encoded or not, is under an install's frame route. */
export function isFramePath(pathname: string): boolean {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // Routing decodes the path too; a malformed escape leaves it as sent.
  }
  return [pathname, decoded].some((path) => /^\/x\/[^/]+\/frame(?:\/|$)/.test(path));
}

interface FileType {
  contentType: string;
  /** The Sec-Fetch-Dest that may load it. */
  destination: string;
}

const FILE_TYPES: Record<string, FileType> = {
  html: { contentType: 'text/html; charset=utf-8', destination: 'iframe' },
  js: { contentType: 'text/javascript; charset=utf-8', destination: 'script' },
  css: { contentType: 'text/css; charset=utf-8', destination: 'style' },
  svg: { contentType: 'image/svg+xml', destination: 'image' },
  png: { contentType: 'image/png', destination: 'image' },
  webp: { contentType: 'image/webp', destination: 'image' },
  woff2: { contentType: 'font/woff2', destination: 'font' },
  json: { contentType: 'application/json', destination: 'json' },
};

const DESTINATIONS = new Set(Object.values(FILE_TYPES).map((type) => type.destination));

const PERMISSIONS_POLICY = [
  'accelerometer',
  'autoplay',
  'bluetooth',
  'camera',
  'clipboard-read',
  'clipboard-write',
  'display-capture',
  'encrypted-media',
  'fullscreen',
  'gamepad',
  'geolocation',
  'gyroscope',
  'hid',
  'identity-credentials-get',
  'idle-detection',
  'local-fonts',
  'magnetometer',
  'microphone',
  'midi',
  'otp-credentials',
  'payment',
  'picture-in-picture',
  'publickey-credentials-create',
  'publickey-credentials-get',
  'screen-wake-lock',
  'serial',
  'storage-access',
  'usb',
  'web-share',
  'window-management',
  'xr-spatial-tracking',
]
  .map((feature) => `${feature}=()`)
  .join(', ');

const appOrigin = (fallback: string) => (env.ATMOBB_APP_URL ? new URL(env.ATMOBB_APP_URL).origin : fallback);

function frameHeaders(origin: string, installId: string, subresource: boolean): Headers {
  // A malformed id never reaches a header; its responses allow no scripts at all.
  const own = INSTALL_ID.test(installId) ? `${origin}/x/${installId}/frame/` : "'none'";
  const policy = [
    'sandbox allow-scripts',
    "default-src 'none'",
    `script-src ${own}`,
    `style-src ${own}`,
    `img-src ${own === "'none'" ? 'data:' : `${own} data:`}`,
    `font-src ${own}`,
    "connect-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'self'",
  ].join('; ');
  return new Headers({
    'content-security-policy': policy,
    'x-content-type-options': 'nosniff',
    // The panel's document has an opaque origin, so a same-origin policy would block its own scripts and styles.
    'cross-origin-resource-policy': subresource ? 'cross-origin' : 'same-origin',
    'cross-origin-opener-policy': 'same-origin',
    'referrer-policy': 'no-referrer',
    'permissions-policy': PERMISSIONS_POLICY,
    'cache-control': 'no-store',
  });
}

export interface FrameRequest {
  installId: string;
  /** The path below the install's frame directory, as routed. */
  path: string;
  headers: Headers;
  /** The request URL's origin, used when ATMOBB_APP_URL isn't set. */
  origin: string;
}

/** The response to a request for one of an install's UI files. */
export async function frameResponse({ installId, path, headers, origin }: FrameRequest): Promise<Response> {
  const own = appOrigin(origin);
  const refuse = (status: number, message: string) => {
    const refusal = frameHeaders(own, installId, false);
    refusal.set('content-type', 'text/plain; charset=utf-8');
    return new Response(message, { status, headers: refusal });
  };

  try {
    const destination = headers.get('sec-fetch-dest');
    if (headers.has('service-worker') || !destination || !DESTINATIONS.has(destination)) return refuse(403, 'Forbidden');
    if (!extensionsEnabled() || !extensionsLockHeld()) return refuse(503, 'Extensions are not running on this server');

    if (!INSTALL_ID.test(installId)) return refuse(404, 'Not found');
    const install = await getInstall(installId);
    const entry = install?.manifest.ui?.entry;
    if (!install || install.state !== 'active' || !entry) return refuse(404, 'Not found');

    const segments = path.split('/');
    if (!segments.every((segment) => SEGMENT.test(segment) && segment !== '.' && segment !== '..')) return refuse(404, 'Not found');
    const extension = /\.([a-z0-9]+)$/.exec(path)?.[1];
    const type = extension && Object.hasOwn(FILE_TYPES, extension) ? FILE_TYPES[extension] : null;
    if (!type) return refuse(404, 'Not found');
    if (type.destination !== destination) return refuse(403, 'Forbidden');

    // Files are served from the directory holding the UI entry, and the entry is the only document.
    const uiDir = posix.dirname(entry);
    const entryPath = uiDir === '.' ? entry : entry.slice(uiDir.length + 1);
    if (type.destination === 'iframe' && path !== entryPath) return refuse(404, 'Not found');

    const file = join(bundleDir(install), ...(uiDir === '.' ? [] : uiDir.split('/')), ...segments);
    const info = await lstat(file).catch(() => null);
    if (!info?.isFile()) return refuse(404, 'Not found');

    const response = frameHeaders(own, installId, type.destination !== 'iframe');
    response.set('content-type', type.contentType);
    return new Response(new Uint8Array(await readFile(file)), { status: 200, headers: response });
  } catch (error) {
    console.error(`[extensions] serving a frame file for ${installId} failed:`, error instanceof Error ? error.message : error);
    return refuse(500, 'Something went wrong');
  }
}

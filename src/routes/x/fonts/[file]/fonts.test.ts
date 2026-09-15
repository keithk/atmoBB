import { describe, expect, it, vi } from 'vitest';

// The fonts route over the real Fontsource files. The seam is SvelteKit's
// asset reader, which only works inside a built server.

const state = vi.hoisted(() => ({ read: vi.fn((url: string) => new Response(`bytes of ${url}`)) }));
vi.mock('$app/server', () => ({ read: state.read }));

import { GET } from './+server';

const FILE = 'ibm-plex-sans-latin-400-normal.woff2';

async function fonts(file: string, dest: string | null) {
  const request = new Request(`https://forum.test/x/fonts/${file}`);
  if (dest !== null) request.headers.set('sec-fetch-dest', dest);
  const cookies = { get: vi.fn(), getAll: vi.fn(), set: vi.fn(), delete: vi.fn(), serialize: vi.fn() };
  const response = await GET({ request, params: { file }, url: new URL(request.url), cookies, locals: { user: null } } as never);
  expect(cookies.get).not.toHaveBeenCalled();
  expect(response.headers.get('set-cookie')).toBeNull();
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
  expect(response.headers.get('access-control-allow-origin')).toBe('*');
  return response;
}

describe('GET /x/fonts/[file]', () => {
  it("serves the stylesheet to a style destination, declaring the forum's UI faces from files beside it", async () => {
    const response = await fonts('fonts.css', 'style');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/css; charset=utf-8');
    const css = await response.text();
    expect(css).toContain(`@font-face{font-family:'IBM Plex Sans';font-style:normal;font-weight:400;font-display:swap;src:url(${FILE}) format('woff2');unicode-range:U+0000-00FF,`);
    expect(css).toContain("font-family:'IBM Plex Sans';font-style:italic;font-weight:500;");
    expect(css).toContain("font-family:'IBM Plex Mono';font-style:normal;font-weight:600;");
    expect(css).not.toContain("font-family:'IBM Plex Mono';font-style:italic");
    expect(css).not.toContain('font-weight:300');
    expect(css).not.toMatch(/url\((?!ibm-plex-(?:sans|mono)-[a-z-]+-\d00-(?:normal|italic)\.woff2\))/);
  });

  it('serves every font file the stylesheet names, to a font destination', async () => {
    const css = await (await fonts('fonts.css', 'style')).text();
    const files = [...css.matchAll(/url\(([^)]+)\)/g)].map(([, file]) => file);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const response = await fonts(file, 'font');
      expect(response.status, file).toBe(200);
      expect(response.headers.get('content-type'), file).toBe('font/woff2');
    }
    expect(await (await fonts(FILE, 'font')).text()).toContain(FILE);
  });

  it('refuses each file to any other destination, and when the destination is missing', async () => {
    for (const [file, dest] of [
      ['fonts.css', 'font'],
      ['fonts.css', 'document'],
      ['fonts.css', 'iframe'],
      ['fonts.css', null],
      [FILE, 'style'],
      [FILE, 'script'],
      [FILE, 'document'],
      [FILE, null],
    ] as [string, string | null][]) {
      const response = await fonts(file, dest);
      expect(response.status, `${file} as ${dest}`).toBe(403);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('answers 404 for anything that is not the stylesheet or one of its files', async () => {
    for (const [file, dest] of [
      ['ibm-plex-sans-latin-300-normal.woff2', 'font'],
      ['ibm-plex-mono-latin-400-italic.woff2', 'font'],
      ['ibm-plex-sans-latin-400-normal.woff', 'font'],
      ['newsreader-latin-400-normal.woff2', 'font'],
      ['..%2Fpackage.json', 'font'],
      ['index.css', 'style'],
      ['', 'style'],
    ]) {
      expect((await fonts(file, dest)).status, file).toBe(404);
    }
  });
});

/**
 * Shared plumbing for the Admin → Appearance sub-pages. Every sub-page reads
 * the forum profile, changes a slice of it, and holds its redirect until the
 * appview shows the saved record.
 */
import { getBoardIndex, FORUM_DID, type ForumFont, type ForumProfile } from './appview';
import { putForumRecord } from './forum-repo';
import { savedRedirect } from './saved-redirect';
import { blobCid } from './profiles';
import { normalizeHomepage } from '$lib/homepage';
import { normalizeTheme } from '$lib/themes';

const PROFILE = 'app.atmobb.forum.profile';

export async function currentProfile(): Promise<ForumProfile> {
  const index = await getBoardIndex(FORUM_DID());
  if (!index.forum) throw new Error('forum profile not found');
  return index.forum;
}

export async function saveProfile(profile: ForumProfile) {
  await putForumRecord(PROFILE, 'self', profile);
}

// Comparable identity of a font list across the write and index shapes (the
// SDK's BlobRef serializes differently from the indexed record's $link JSON).
const fontFingerprint = (fonts?: ForumFont[]) =>
  JSON.stringify((fonts ?? []).map((f) => [blobCid(f.source), f.family, f.weight, f.style]));

/** Hold the redirect until the saved profile is visible in the index. */
export const profileRedirect = (dest: string, saved: ForumProfile) =>
  savedRedirect(
    dest,
    () => getBoardIndex(FORUM_DID()),
    (i) =>
      !!i.forum &&
      normalizeTheme(i.forum.theme) === normalizeTheme(saved.theme) &&
      (i.forum.customCss ?? '') === (saved.customCss ?? '') &&
      fontFingerprint(i.forum.customFonts) === fontFingerprint(saved.customFonts) &&
      blobCid(i.forum.favicon) === blobCid(saved.favicon) &&
      blobCid(i.forum.ogImage) === blobCid(saved.ogImage) &&
      (i.forum.ogTheme ?? 'classic') === (saved.ogTheme ?? 'classic') &&
      JSON.stringify(normalizeHomepage(i.forum.homepage)) === JSON.stringify(normalizeHomepage(saved.homepage)),
  );

export function imageMime(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export function isOgPng(bytes: Uint8Array): boolean {
  if (bytes.length < 24) return false;
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((byte, index) => bytes[index] === byte)) return false;
  if (String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(16) === 1200 && view.getUint32(20) === 630;
}

export function fontMime(bytes: Uint8Array): 'font/woff' | 'font/woff2' | null {
  if (bytes.length < 4) return null;
  const signature = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (signature === 'wOFF') return 'font/woff';
  if (signature === 'wOF2') return 'font/woff2';
  return null;
}

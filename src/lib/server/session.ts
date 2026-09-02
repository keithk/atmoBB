import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';
import type { Cookies } from '@sveltejs/kit';

export const APP_COOKIE = 'atmobb_session';

const secret = () => env.ATMOBB_COOKIE_SECRET ?? 'dev-cookie-secret';

const sign = (value: string) =>
  createHmac('sha256', secret()).update(value).digest('base64url');

export function setSessionCookie(cookies: Cookies, did: string) {
  cookies.set(APP_COOKIE, `${did}.${sign(did)}`, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
  });
}

export function clearSessionCookie(cookies: Cookies) {
  cookies.delete(APP_COOKIE, { path: '/' });
}

export function sessionDid(cookies: Cookies): string | null {
  const raw = cookies.get(APP_COOKIE);
  if (!raw) return null;
  const i = raw.lastIndexOf('.');
  if (i < 1) return null;
  const did = raw.slice(0, i);
  const mac = raw.slice(i + 1);
  const expected = sign(did);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return did;
}

import { env } from '$env/dynamic/private';

/** A positive whole-number setting from the environment, or `fallback` when it's unset or isn't one. */
export function envInt(name: string, fallback: number): number {
  const raw = env[name];
  const value = raw ? Number(raw) : NaN;
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

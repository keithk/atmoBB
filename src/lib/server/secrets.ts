// Shared rules for the secrets that gate sessions. The app's own cookie secret
// signs atmobb_session; the Happyview session secret signs the cookies we mint
// to act as members inside permissioned spaces. A forgeable value for either
// lets anyone act as any DID, so production refuses to start with one.
// Mirrors Happyview's own SESSION_SECRET checks (32 bytes, no placeholders).

export const MIN_SECRET_BYTES = 32;

const PLACEHOLDERS = new Set([
  'dev-cookie-secret',
  'dev-only-secret-not-for-production',
  'change-me-in-production',
  'change-me-in-production-not-secure',
]);

/** Why `value` is unfit to sign sessions, or null if it's fine. */
export function secretProblem(value: string | undefined): string | null {
  if (!value) return 'is not set';
  if (PLACEHOLDERS.has(value)) return 'is a known placeholder value';
  if (Buffer.byteLength(value) < MIN_SECRET_BYTES) {
    return `is only ${Buffer.byteLength(value)} bytes; it needs at least ${MIN_SECRET_BYTES}`;
  }
  return null;
}

export const isProduction = (nodeEnv: string | undefined) => (nodeEnv ?? 'development') === 'production';

/**
 * The startup errors for a production environment, one per bad secret. The
 * cookie secret is required; the Happyview session secret is optional (it
 * turns on members-only boards) but must be strong when present.
 */
export function productionSecretErrors(env: {
  NODE_ENV?: string;
  ATMOBB_COOKIE_SECRET?: string;
  HAPPYVIEW_SESSION_SECRET?: string;
}): string[] {
  if (!isProduction(env.NODE_ENV)) return [];
  const hint = 'Generate one with `openssl rand -hex 32`.';
  const errors: string[] = [];
  const cookie = secretProblem(env.ATMOBB_COOKIE_SECRET);
  if (cookie) errors.push(`ATMOBB_COOKIE_SECRET ${cookie}. ${hint}`);
  if (env.HAPPYVIEW_SESSION_SECRET !== undefined) {
    const hv = secretProblem(env.HAPPYVIEW_SESSION_SECRET);
    if (hv) errors.push(`HAPPYVIEW_SESSION_SECRET ${hv}. It must equal Happyview's SESSION_SECRET.`);
  }
  return errors;
}

/** Refuse to serve anything in production until the session secrets are safe. */
export function assertProductionSecrets(env: Parameters<typeof productionSecretErrors>[0]): void {
  const errors = productionSecretErrors(env);
  if (errors.length) {
    throw new Error(`Refusing to start:\n  - ${errors.join('\n  - ')}`);
  }
}

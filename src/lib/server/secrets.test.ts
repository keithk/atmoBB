import { describe, expect, it } from 'vitest';
import { assertProductionSecrets, productionSecretErrors, secretProblem } from './secrets';

const strong = 'a'.repeat(64);

describe('secretProblem', () => {
  it('accepts a 32-byte-plus random value', () => {
    expect(secretProblem(strong)).toBeNull();
  });
  it('rejects missing, short, and placeholder values', () => {
    expect(secretProblem(undefined)).toMatch(/not set/);
    expect(secretProblem('')).toMatch(/not set/);
    expect(secretProblem('short')).toMatch(/bytes/);
    expect(secretProblem('dev-cookie-secret')).toMatch(/placeholder/);
    expect(secretProblem('dev-only-secret-not-for-production')).toMatch(/placeholder/);
  });
});

describe('productionSecretErrors', () => {
  it('checks nothing outside production', () => {
    expect(productionSecretErrors({ NODE_ENV: 'development' })).toEqual([]);
    expect(productionSecretErrors({})).toEqual([]);
  });
  it('requires the cookie secret in production', () => {
    const errors = productionSecretErrors({ NODE_ENV: 'production' });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/ATMOBB_COOKIE_SECRET/);
  });
  it('leaves the Happyview secret optional but checks it when set', () => {
    expect(productionSecretErrors({ NODE_ENV: 'production', ATMOBB_COOKIE_SECRET: strong })).toEqual([]);
    const errors = productionSecretErrors({
      NODE_ENV: 'production',
      ATMOBB_COOKIE_SECRET: strong,
      HAPPYVIEW_SESSION_SECRET: 'dev-only-secret-not-for-production',
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/HAPPYVIEW_SESSION_SECRET/);
  });
  it('reports every bad secret at once', () => {
    expect(
      productionSecretErrors({ NODE_ENV: 'production', ATMOBB_COOKIE_SECRET: 'x', HAPPYVIEW_SESSION_SECRET: 'y' }),
    ).toHaveLength(2);
  });
});

describe('assertProductionSecrets', () => {
  it('throws with every problem listed', () => {
    expect(() => assertProductionSecrets({ NODE_ENV: 'production', HAPPYVIEW_SESSION_SECRET: 'y' })).toThrow(
      /ATMOBB_COOKIE_SECRET[\s\S]*HAPPYVIEW_SESSION_SECRET/,
    );
  });
  it('passes a well-configured production environment', () => {
    expect(() =>
      assertProductionSecrets({ NODE_ENV: 'production', ATMOBB_COOKIE_SECRET: strong, HAPPYVIEW_SESSION_SECRET: strong }),
    ).not.toThrow();
  });
});

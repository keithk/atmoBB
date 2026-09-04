import type { SessionUser } from '$lib/server/appview';

declare global {
  /** Release version from package.json, injected by vite.config.ts. */
  const __ATMOBB_VERSION__: string;

  namespace App {
    interface Locals {
      user: SessionUser | null;
    }
  }
}

export {};

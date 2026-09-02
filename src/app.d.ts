import type { SessionUser } from '$lib/server/appview';

declare global {
  namespace App {
    interface Locals {
      user: SessionUser | null;
    }
  }
}

export {};

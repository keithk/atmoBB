/**
 * Settles as `work` does, or rejects with `expired()` once `ms` pass first.
 * Work that loses the race isn't cancelled and may still finish later; its
 * outcome is dropped. The timer is unref'd so it never keeps the process alive.
 */
export function beforeDeadline<T>(work: T | Promise<T>, ms: number, expired: () => Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = Promise.resolve(work);
  settled.catch(() => {});
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(expired()), ms);
    timer.unref?.();
  });
  return Promise.race([settled, deadline]).finally(() => clearTimeout(timer));
}

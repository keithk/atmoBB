// Serialize local privacy changes with the access-check-and-write operation.
// This is an in-process guard for the single-app deployment, not a distributed
// lock against a different app writing to the same forum account.
const pending = new Map<string, Promise<void>>();

export async function withBoardWrite<T>(board: string, action: () => Promise<T>): Promise<T> {
  const previous = pending.get(board) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  pending.set(board, current);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (pending.get(board) === current) pending.delete(board);
  }
}

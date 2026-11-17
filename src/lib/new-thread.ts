/** A board a member can start a thread in, as the new-thread composer's picker shows it. */
export interface ComposeBoard {
  uri: string;
  /** The board page; the thread posts to its `newThread` action. */
  path: string;
  name: string;
  color?: string;
  emoji?: string;
  /** Members-only: no images, no polls (the server refuses both). */
  private: boolean;
  /** Category heading the picker groups it under. */
  group: string;
  /** A sub-board, shown indented under its parent. */
  child: boolean;
}

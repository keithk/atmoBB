export interface Rank {
  title: string;
  minPosts: number;
}

/** The rank a postcount has earned, plus its index in the ladder (for pips). */
export function rankFor(ranks: Rank[], posts: number): { title: string; index: number } {
  let title = '';
  let index = -1;
  ranks.forEach((r, i) => {
    if (posts >= r.minPosts) {
      title = r.title;
      index = i;
    }
  });
  return { title, index };
}

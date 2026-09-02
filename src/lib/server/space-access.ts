import {
  FORUM_DID,
  getBoardIndex,
  listSpaceMembers,
  removeSpaceMember,
  spaceOfBoard,
  type SpaceMember,
} from './appview';

// Space membership is what actually gates a members-only board, so anything
// that's meant to keep someone out (a ban, a revoke) has to touch it. Bans
// alone only stop writes, and space reads never see them.

/** This forum's members-only boards, with the space behind each. */
export async function privateBoards(): Promise<{ uri: string; name: string; space: string }[]> {
  const index = await getBoardIndex(FORUM_DID());
  return index.boards.flatMap((b) => {
    const space = spaceOfBoard(b.value.access);
    return space ? [{ uri: b.uri, name: b.value.name, space }] : [];
  });
}

/**
 * Remove `did` from the spaces a ban on `board` covers: that board's space,
 * or every private board's when the ban is forum-wide. Returns the board URIs
 * it left. Throws on the first removal that fails, so the caller can say so.
 */
export async function revokeSpaceAccess(did: string, board?: string): Promise<string[]> {
  const boards = (await privateBoards()).filter((b) => !board || b.uri === board);
  const left: string[] = [];
  for (const b of boards) {
    const members = await listSpaceMembers(b.space);
    if (!members.some((m) => m.did === did)) continue;
    await removeSpaceMember(b.space, did);
    left.push(b.uri);
  }
  return left;
}

/** A private board's members other than the forum account, which is the space authority. */
export async function boardMembers(space: string): Promise<SpaceMember[]> {
  return (await listSpaceMembers(space)).filter((m) => m.did !== FORUM_DID());
}

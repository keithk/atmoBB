import { describe, expect, it } from 'vitest';
import { grantCovers } from './staff';

const a = 'at://did:plc:forum/app.atmobb.forum.board/aaa';
const b = 'at://did:plc:forum/app.atmobb.forum.board/bbb';

describe('grantCovers', () => {
  it('lets admins moderate everywhere, scope or not', () => {
    expect(grantCovers({ subject: 'x', role: 'admin' }, a)).toBe(true);
    expect(grantCovers({ subject: 'x', role: 'admin', boards: [b] }, a)).toBe(true);
  });
  it('treats an unscoped moderator grant as forum-wide', () => {
    expect(grantCovers({ subject: 'x', role: 'moderator' }, a)).toBe(true);
    expect(grantCovers({ subject: 'x', role: 'moderator', boards: [] }, a)).toBe(true);
  });
  it('limits a scoped moderator to the boards named', () => {
    const grant = { subject: 'x', role: 'moderator', boards: [b] };
    expect(grantCovers(grant, b)).toBe(true);
    expect(grantCovers(grant, a)).toBe(false);
  });
});

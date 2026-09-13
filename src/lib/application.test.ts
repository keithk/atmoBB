import { describe, expect, it } from 'vitest';
import { applicationState, grandfatherSet, posterDids } from './application';

const app = { uri: 'at://did:plc:a/app.atmobb.forum.accessRequest/1', did: 'did:plc:a', createdAt: '2026-09-10T00:00:00Z' };
const at = (day: number) => `2026-09-${String(day).padStart(2, '0')}T00:00:00Z`;

describe('applicationState', () => {
  it('is pending with no decision newer than the application', () => {
    expect(applicationState(app, [])).toBe('pending');
    expect(applicationState(app, [{ action: 'denyAccess', createdAt: at(1) }])).toBe('pending');
  });
  it('follows the newest decision', () => {
    expect(applicationState(app, [{ action: 'holdApplication', createdAt: at(11) }])).toBe('waiting');
    expect(applicationState(app, [{ action: 'holdApplication', createdAt: at(11) }, { action: 'denyAccess', createdAt: at(12) }])).toBe('denied');
    expect(applicationState(app, [{ action: 'denyAccess', createdAt: at(11) }, { action: 'acceptMember', createdAt: at(12) }])).toBe('accepted');
  });
  it('ignores board-scoped decisions and unrelated kinds', () => {
    expect(applicationState(app, [{ action: 'denyAccess', createdAt: at(11), board: 'at://did:plc:f/app.atmobb.forum.board/x' }])).toBe('pending');
    expect(applicationState(app, [{ action: 'warn', createdAt: at(11) }])).toBe('pending');
  });
});

describe('posterDids', () => {
  const forum = 'did:plc:forum';
  const thread = (board: string, extra = {}) => ({ board, author: 'did:plc:author', ...extra });
  it('collects the author, last replier, and participants of the forum\'s own threads', () => {
    const t = thread(`at://${forum}/app.atmobb.forum.board/general`, {
      lastReplyBy: 'did:plc:last',
      participants: [{ did: 'did:plc:p1' }, { did: 'did:plc:p2' }],
    });
    expect(posterDids([t], forum)).toEqual(['did:plc:author', 'did:plc:last', 'did:plc:p1', 'did:plc:p2']);
    expect(posterDids([thread(`at://${forum}/app.atmobb.forum.board/general`)], forum)).toEqual(['did:plc:author']);
  });
  it('skips merged-topic threads from other forums', () => {
    expect(posterDids([thread('at://did:plc:other/app.atmobb.forum.board/x', { lastReplyBy: 'did:plc:last' })], forum)).toEqual([]);
  });
});

describe('grandfatherSet', () => {
  const forum = 'did:plc:forum';
  it('unions declarers, posters, and staff once each and drops the forum account', () => {
    expect(
      grandfatherSet({ declarers: ['did:plc:a', 'did:plc:b'], posters: ['did:plc:b', 'did:plc:c', forum], staff: ['did:plc:c', 'did:plc:s'] }, forum),
    ).toEqual(['did:plc:a', 'did:plc:b', 'did:plc:c', 'did:plc:s']);
  });
});

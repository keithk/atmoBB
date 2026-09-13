import { describe, expect, it } from 'vitest';
import { applicationState, grandfatherSet } from './application';

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

describe('grandfatherSet', () => {
  it('unions declarers and posters once each and drops the forum account', () => {
    const forum = 'did:plc:forum';
    expect(grandfatherSet(['did:plc:a', 'did:plc:b'], ['did:plc:b', 'did:plc:c', forum], forum)).toEqual(['did:plc:a', 'did:plc:b', 'did:plc:c']);
  });
});

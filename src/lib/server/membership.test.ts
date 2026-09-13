import { describe, expect, it } from 'vitest';
import { membershipMessage } from './membership';

describe('membershipMessage', () => {
  it('tells an accepted account to finish joining', () => {
    expect(membershipMessage('apply', 'accepted-undeclared')).toBe('Finish joining to post.');
    expect(membershipMessage('invite', 'accepted-undeclared')).toBe('Finish joining to post.');
  });

  it("names the mode's way in for a non-member", () => {
    expect(membershipMessage('apply', 'nonmember')).toBe('Only members can post here. Apply to join first.');
    expect(membershipMessage('invite', 'nonmember')).toBe('Only members can post here. This forum is invite only.');
  });
});

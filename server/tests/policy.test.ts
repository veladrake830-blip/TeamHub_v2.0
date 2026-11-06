import { describe, expect, it } from 'vitest';
import {
  canEditContent,
  canIssueResetLink,
  canLeaveTeam,
  canRecordLogs,
  canRemoveOrDemoteLeader,
  type Actor,
  type Role,
  type Target,
} from '../src/lib/policy.ts';

const actor = (id: string, teams: Record<string, Role> = {}, isAdmin = false): Actor => ({
  id,
  isAdmin,
  teams: new Map(Object.entries(teams)),
});
const target = (id: string, teams: Record<string, Role> = {}, extra: Partial<Target> = {}): Target => ({
  id,
  isAdmin: false,
  status: 'ACTIVE',
  teams: new Map(Object.entries(teams)),
  ...extra,
});
const admin = actor('admin', {}, true);

describe('canIssueResetLink', () => {
  const leader = actor('leader', { a: 'TEAM_LEADER' });

  it('lets the Admin issue for any active non-Admin user', () => {
    expect(canIssueResetLink(admin, target('x'))).toBe(true);
    expect(canIssueResetLink(admin, target('x', { a: 'TEAM_LEADER' }))).toBe(true);
  });
  it('never allows a link for the Admin, even from the Admin', () => {
    expect(canIssueResetLink(admin, target('admin', {}, { isAdmin: true }))).toBe(false);
  });
  it('refuses accounts that are not active', () => {
    expect(canIssueResetLink(admin, target('x', {}, { status: 'PENDING' }))).toBe(false);
    expect(canIssueResetLink(admin, target('x', {}, { status: 'DEACTIVATED' }))).toBe(false);
  });
  it('lets a leader issue for a Member of their team', () => {
    expect(canIssueResetLink(leader, target('x', { a: 'MEMBER' }))).toBe(true);
  });
  it('refuses a co-leader', () => {
    expect(canIssueResetLink(leader, target('x', { a: 'TEAM_LEADER' }))).toBe(false);
  });
  it('refuses a Member of this team who leads a different team', () => {
    expect(canIssueResetLink(leader, target('x', { a: 'MEMBER', b: 'TEAM_LEADER' }))).toBe(false);
  });
  it('refuses a user outside the leader\'s teams', () => {
    expect(canIssueResetLink(leader, target('x', { b: 'MEMBER' }))).toBe(false);
  });
  it('refuses members, and issuing for yourself', () => {
    expect(canIssueResetLink(actor('m', { a: 'MEMBER' }), target('x', { a: 'MEMBER' }))).toBe(false);
    expect(canIssueResetLink(leader, target('leader', { a: 'TEAM_LEADER' }))).toBe(false);
  });
});

describe('last TeamLeader rules', () => {
  it('blocks the last active leader from leaving, but not a co-leader', () => {
    expect(canLeaveTeam('a', ['a'])).toBe(false);
    expect(canLeaveTeam('a', ['a', 'b'])).toBe(true);
    expect(canLeaveTeam('m', ['a'])).toBe(true);
  });
  it('lets only the Admin remove or demote the last active leader', () => {
    expect(canRemoveOrDemoteLeader(actor('b', { t: 'TEAM_LEADER' }), 'a', ['a'])).toBe(false);
    expect(canRemoveOrDemoteLeader(admin, 'a', ['a'])).toBe(true);
    expect(canRemoveOrDemoteLeader(actor('b', { t: 'TEAM_LEADER' }), 'a', ['a', 'b'])).toBe(true);
  });
});

describe('canRecordLogs', () => {
  it('allows team members only', () => {
    expect(canRecordLogs(actor('x', { a: 'MEMBER' }))).toBe(true);
    expect(canRecordLogs(actor('x', { a: 'TEAM_LEADER' }))).toBe(true);
    expect(canRecordLogs(actor('x'))).toBe(false);
    expect(canRecordLogs(admin)).toBe(false);
  });
});

describe('canEditContent', () => {
  it('follows the content rules', () => {
    expect(canEditContent(admin, 'x', [])).toBe(true);
    expect(canEditContent(actor('x'), 'x', [])).toBe(true);
    expect(canEditContent(actor('l', { a: 'TEAM_LEADER' }), 'x', ['b', 'a'])).toBe(true);
    expect(canEditContent(actor('l', { a: 'TEAM_LEADER' }), 'x', ['b'])).toBe(false);
    expect(canEditContent(actor('m', { a: 'MEMBER' }), 'x', ['a'])).toBe(false);
  });
});

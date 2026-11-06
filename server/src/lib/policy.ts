// Every permission rule lives here, as pure functions, so the table in Readme section 2
// can be tested directly. Routes only ask these questions; they never decide for themselves.

export type Role = 'TEAM_LEADER' | 'MEMBER';

export interface Actor {
  id: string;
  isAdmin: boolean;
  /** teamId -> role, always loaded fresh from the database. */
  teams: Map<string, Role>;
}

export interface Target {
  id: string;
  isAdmin: boolean;
  status: 'PENDING' | 'ACTIVE' | 'DEACTIVATED';
  teams: Map<string, Role>;
  /** See canIssueResetLink. */
  resetLockedUntil?: Date | null;
}

export const leadsTeam = (actor: Actor, teamId: string) => actor.teams.get(teamId) === 'TEAM_LEADER';
export const managesTeam = (actor: Actor, teamId: string) => actor.isAdmin || leadsTeam(actor, teamId);

export const canCreateTeam = (actor: Actor) => actor.isAdmin;
export const canEditTeamInfo = managesTeam;
export const canManageMembers = managesTeam;
export const canChangeRoles = managesTeam;
export const canManageAccounts = (actor: Actor) => actor.isAdmin;
export const canSeeAuditLog = (actor: Actor) => actor.isAdmin;

/** Team members record logs. The Admin and users without a team do not. */
export const canRecordLogs = (actor: Actor) => !actor.isAdmin && actor.teams.size > 0;

export const canManageOrganization = (actor: Actor) => actor.isAdmin;

/** Only the owner changes a plan, while they are on a team and the day is inside the edit window. */
export const canEditOwnLog = (actor: Actor, ownerId: string, inEditWindow: boolean) =>
  canRecordLogs(actor) && actor.id === ownerId && inEditWindow;

/**
 * Password reset links.
 * - Nobody issues one for the Admin, who is reset by a server script.
 * - Only active accounts can receive one.
 * - The Admin can issue one for any other user.
 * - A TeamLeader can issue one for a member of a team they lead, unless that user
 *   leads any team, because the person holding a link can take over the account.
 * - That protection stays for a while after someone stops being a TeamLeader. Otherwise a
 *   leader could demote a co-leader, issue a link, and promote them again.
 */
export function canIssueResetLink(actor: Actor, target: Target): boolean {
  if (target.isAdmin || target.status !== 'ACTIVE') return false;
  if (actor.isAdmin) return true;
  if (target.id === actor.id) return false;
  if (target.resetLockedUntil && target.resetLockedUntil > new Date()) return false;
  for (const role of target.teams.values()) if (role === 'TEAM_LEADER') return false;
  for (const teamId of target.teams.keys()) if (leadsTeam(actor, teamId)) return true;
  return false;
}

/**
 * The last active TeamLeader of a team cannot leave, and only the Admin can remove or
 * demote them. `activeLeaderIds` must exclude deactivated leaders.
 */
export function canRemoveOrDemoteLeader(actor: Actor, targetId: string, activeLeaderIds: string[]): boolean {
  const isLastLeader = activeLeaderIds.length === 1 && activeLeaderIds[0] === targetId;
  return !isLastLeader || actor.isAdmin;
}

export function canLeaveTeam(userId: string, activeLeaderIds: string[]): boolean {
  return !(activeLeaderIds.length === 1 && activeLeaderIds[0] === userId);
}

/** Used from Milestone 4 for news, topics and answers. */
export function canEditContent(actor: Actor, authorId: string, authorTeamIds: string[]): boolean {
  if (actor.isAdmin || actor.id === authorId) return true;
  return authorTeamIds.some((teamId) => leadsTeam(actor, teamId));
}

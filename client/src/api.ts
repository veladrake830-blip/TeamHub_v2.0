import type { Theme } from './theme';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// The access token lives only in memory. The refresh token is in an httpOnly cookie
// that scripts cannot read, so a reload recovers a session through /refresh.
let accessToken: string | null = null;
export const setAccessToken = (token: string | null) => {
  accessToken = token;
};

let refreshing: Promise<boolean> | null = null;

async function requestRefresh(): Promise<boolean> {
  const res = await fetch('/api/auth/refresh', { method: 'POST' });
  if (!res.ok) {
    accessToken = null;
    return false;
  }
  accessToken = (await res.json()).accessToken;
  return true;
}

/** One refresh at a time. The lock covers other tabs, which share the same cookie. */
export function refreshSession(): Promise<boolean> {
  refreshing ??= (navigator.locks ? navigator.locks.request('teamhub-refresh', requestRefresh) : requestRefresh()).finally(
    () => {
      refreshing = null;
    },
  );
  return refreshing;
}

interface Options {
  method?: string;
  body?: unknown;
  form?: FormData;
}

function send(path: string, { method = 'GET', body, form }: Options) {
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(`/api${path}`, {
    method,
    headers,
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
}

export async function api<T = void>(path: string, options: Options = {}): Promise<T> {
  let res = await send(path, options);
  if (res.status === 401 && !path.startsWith('/auth/login') && (await refreshSession())) {
    res = await send(path, options);
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.code ?? 'ERROR', data?.error?.message ?? 'Something went wrong.');
  }
  return data as T;
}

export interface TeamRef {
  id: string;
  name: string;
  avatarUrl: string | null;
}
export type Role = 'TEAM_LEADER' | 'MEMBER';
export interface Me {
  id: string;
  name: string;
  email: string;
  slogan: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  theme: Theme;
  passwordResetNoticeAt: string | null;
  pendingInvitations: number;
  teams: (TeamRef & { role: Role })[];
}
export interface Page<T> {
  total: number;
  items: T[];
}
export interface UserListItem {
  id: string;
  name: string;
  avatarUrl: string | null;
  slogan: string;
  email?: string;
  status?: string;
}
export interface Profile {
  id: string;
  name: string;
  avatarUrl: string | null;
  slogan: string;
  isAdmin: boolean;
  deactivated: boolean;
  email?: string;
  teams: (TeamRef & { role: Role })[];
  followingUsers: TeamRef[];
  followingTeams: TeamRef[];
  isFollowing: boolean;
  canIssueResetLink: boolean;
}
export interface TeamListItem extends TeamRef {
  slogan: string;
  memberCount: number;
}
export interface TeamDetail extends TeamRef {
  slogan: string;
  members: (TeamRef & { role: Role; deactivated: boolean })[];
  hasActiveLeader: boolean;
  myRole: Role | null;
  myInvitationId: string | null;
  myJoinRequestId: string | null;
  isFollowing: boolean;
  canManage: boolean;
  invitations: { id: string; user: TeamRef }[];
  joinRequests: { id: string; user: TeamRef }[];
}
export interface Invitation {
  id: string;
  team: TeamRef;
  invitedBy: string;
}
export interface ActivityEntryInput {
  start: string;
  end: string;
  category: string;
  note: string;
}
export interface ActivityEntry extends ActivityEntryInput {
  id: string;
  date: string;
  minutes: number;
  source: string;
  user: TeamRef & { deactivated: boolean };
  canEdit: boolean;
}
export interface ActivityPage {
  total: number;
  today: string;
  timezone: string;
  canRecord: boolean;
  items: ActivityEntry[];
}
export interface ActivityDashboard {
  from: string;
  to: string;
  today: string;
  timezone: string;
  totalMinutes: number;
  entryCount: number;
  peopleCount: number;
  byDay: { date: string; minutes: number }[];
  byCategory: { category: string; minutes: number }[];
  byPerson: (TeamRef & { minutes: number; activeDays: number })[];
}
export type PostKind = 'NEWS' | 'TOPIC';
export type PostAuthor = TeamRef & { deactivated: boolean };
export interface PostListItem {
  id: string;
  kind: PostKind;
  title: string;
  excerpt: string;
  author: PostAuthor;
  createdAt: string;
  editedAt: string | null;
  answerCount: number;
  canEdit: boolean;
}
export type PostListPage = Page<PostListItem>;
export interface PostAnswer {
  id: string;
  body: string;
  author: PostAuthor;
  createdAt: string;
  editedAt: string | null;
  canEdit: boolean;
}
export interface PostDetail {
  id: string;
  kind: PostKind;
  title: string;
  body: string;
  author: PostAuthor;
  createdAt: string;
  editedAt: string | null;
  canEdit: boolean;
  answers: PostAnswer[];
}
export interface WorkTaskInput {
  title: string;
  result: string;
}
export interface WorkPlan {
  id: string;
  date: string;
  user: TeamRef & { deactivated: boolean };
  tasks: (WorkTaskInput & { id: string })[];
  canEdit: boolean;
}
export interface WorkLogPage {
  total: number;
  today: string;
  timezone: string;
  canRecord: boolean;
  items: WorkPlan[];
}
export interface OrganizationSettings {
  timezone: string;
  today: string;
}
export interface AuditEntry {
  id: string;
  action: string;
  actorId: string | null;
  actorName: string | null;
  targetType: string | null;
  targetId: string | null;
  targetName: string | null;
  details: unknown;
  ip: string | null;
  createdAt: string;
}
export interface AuditPage {
  items: AuditEntry[];
  nextBefore: string | null;
}
export interface AdminSummary {
  counts: { active: number; pending: number; deactivated: number; teams: number };
  pending: { id: string; name: string; email: string; createdAt: string }[];
  leaderlessTeams: { id: string; name: string }[];
  recentActivity: AuditEntry[];
}
export interface ResetLink {
  url: string;
  expiresAt: string;
}

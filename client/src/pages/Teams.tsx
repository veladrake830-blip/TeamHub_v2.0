import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type Page, type Role, type TeamDetail, type TeamListItem, type UserListItem } from '../api';
import { useMe } from '../auth';
import { Avatar, ErrorText, Field, PageHeader, roleLabel, useAction, UserPicker } from '../components/ui';

function CreateTeam({ onDone }: { onDone(): void }) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [slogan, setSlogan] = useState('');
  const [leader, setLeader] = useState<UserListItem | null>(null);
  const create = useAction(async () => {
    const team = await api<{ id: string }>('/teams', {
      method: 'POST',
      body: { name, slogan, leaderId: leader?.id },
    });
    navigate(`/teams/${team.id}`);
  }, [['teams']]);

  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <h2>New team</h2>
      <Field label="Team name">
        <input className="input" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Slogan">
        <input className="input" maxLength={200} value={slogan} onChange={(e) => setSlogan(e.target.value)} />
      </Field>
      {leader ? (
        <p>
          First TeamLeader: <strong>{leader.name}</strong>{' '}
          <button type="button" className="btn ghost small" onClick={() => setLeader(null)}>
            Change
          </button>
        </p>
      ) : (
        <UserPicker label="First TeamLeader" onPick={setLeader} />
      )}
      <ErrorText error={create.error} />
      <div className="row">
        <button className="btn primary" disabled={!leader || create.isPending}>
          Create team
        </button>
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function Teams() {
  const me = useMe();
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const teams = useQuery({
    queryKey: ['teams', 'directory', q],
    queryFn: () => api<Page<TeamListItem>>(`/teams?pageSize=100&q=${encodeURIComponent(q)}`),
  });
  return (
    <>
      <PageHeader
        title="Teams"
        subtitle={teams.data ? `${teams.data.total} teams` : undefined}
        actions={
          me.isAdmin && !creating ? (
            <button className="btn primary" onClick={() => setCreating(true)}>
              New team
            </button>
          ) : undefined
        }
      />
      {creating && <CreateTeam onDone={() => setCreating(false)} />}
      <input className="input search" placeholder="Search by name" aria-label="Search teams" value={q} onChange={(e) => setQ(e.target.value)} />
      <ErrorText error={teams.error} />
      {teams.data?.total === 0 && !q && <div className="empty">No teams yet.</div>}
      <ul className="list">
        {teams.data?.items.map((team) => (
          <li key={team.id} className="list-row">
            <Avatar name={team.name} url={team.avatarUrl} />
            <div className="grow">
              <Link to={`/teams/${team.id}`}>{team.name}</Link>
              {team.slogan && <div className="muted small">{team.slogan}</div>}
            </div>
            <span className="muted small">
              {team.memberCount} {team.memberCount === 1 ? 'member' : 'members'}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

function EditTeam({ team, onDone }: { team: TeamDetail; onDone(): void }) {
  const [name, setName] = useState(team.name);
  const [slogan, setSlogan] = useState(team.slogan);
  const key = ['teams', team.id];
  const save = useAction(
    () => api(`/teams/${team.id}`, { method: 'PATCH', body: { name, slogan } }).then(onDone),
    [key, ['teams', 'directory'], ['me']],
  );
  const upload = useAction(
    (file: File) => {
      const form = new FormData();
      form.append('avatar', file);
      return api(`/teams/${team.id}/avatar`, { method: 'PUT', form });
    },
    [key, ['teams', 'directory']],
  );
  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <h2>Edit team</h2>
      <Field label="Team name">
        <input className="input" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Slogan">
        <input className="input" maxLength={200} value={slogan} onChange={(e) => setSlogan(e.target.value)} />
      </Field>
      <label className="btn">
        Upload avatar
        <input
          hidden
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload.mutate(file);
            e.target.value = '';
          }}
        />
      </label>
      <ErrorText error={save.error ?? upload.error} />
      <div className="row">
        <button className="btn primary" disabled={save.isPending}>
          Save
        </button>
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ManagePanel({ team }: { team: TeamDetail }) {
  const me = useMe();
  const key = ['teams', team.id];
  const invite = useAction(
    (userId: string) => api(`/teams/${team.id}/invitations`, { method: 'POST', body: { userId } }),
    [key],
  );
  const cancel = useAction((id: string) => api(`/teams/${team.id}/invitations/${id}`, { method: 'DELETE' }), [key]);
  const decide = useAction(
    ({ id, decision }: { id: string; decision: 'approve' | 'reject' }) =>
      api(`/teams/${team.id}/join-requests/${id}/${decision}`, { method: 'POST' }),
    [key, ['me']],
  );
  const appoint = useAction(
    (userId: string) => api(`/teams/${team.id}/leaders`, { method: 'POST', body: { userId } }),
    [key],
  );
  const taken = [
    ...team.members.map((m) => m.id),
    ...team.invitations.map((i) => i.user.id),
    ...(me.isAdmin ? [me.id] : []),
  ];

  return (
    <section>
      {me.isAdmin && !team.hasActiveLeader && (
        <div className="notice">
          <div className="grow">
            <strong>This team has no active TeamLeader.</strong> Appoint a new one.
            <UserPicker label="New TeamLeader" exclude={[me.id]} onPick={(user) => appoint.mutate(user.id)} />
            <ErrorText error={appoint.error} />
          </div>
        </div>
      )}

      {team.joinRequests.length > 0 && (
        <>
          <h2>Join requests</h2>
          <ErrorText error={decide.error} />
          <ul className="list">
            {team.joinRequests.map((request) => (
              <li key={request.id} className="list-row">
                <Avatar name={request.user.name} url={request.user.avatarUrl} size={32} />
                <Link className="grow" to={`/people/${request.user.id}`}>
                  {request.user.name}
                </Link>
                <button className="btn primary small" onClick={() => decide.mutate({ id: request.id, decision: 'approve' })}>
                  Approve
                </button>
                <button className="btn small" onClick={() => decide.mutate({ id: request.id, decision: 'reject' })}>
                  Reject
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>Invite someone</h2>
      <UserPicker label="Person" exclude={taken} onPick={(user) => invite.mutate(user.id)} />
      <ErrorText error={invite.error ?? cancel.error} />
      {team.invitations.length > 0 && (
        <ul className="list">
          {team.invitations.map((invitation) => (
            <li key={invitation.id} className="list-row">
              <Avatar name={invitation.user.name} url={invitation.user.avatarUrl} size={32} />
              <div className="grow">
                {invitation.user.name} <span className="muted small">invited</span>
              </div>
              <button className="btn ghost small" onClick={() => cancel.mutate(invitation.id)}>
                Cancel
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Members({ team }: { team: TeamDetail }) {
  const me = useMe();
  const key = ['teams', team.id];
  const setRole = useAction(
    ({ userId, role }: { userId: string; role: Role }) =>
      api(`/teams/${team.id}/members/${userId}`, { method: 'PATCH', body: { role } }),
    [key, ['me']],
  );
  const remove = useAction((userId: string) => api(`/teams/${team.id}/members/${userId}`, { method: 'DELETE' }), [key, ['me']]);
  const { reset: clearRoleError } = setRole;
  const { reset: clearRemoveError } = remove;

  // An old failure shouldn't stay on screen after the team changes in some other way.
  useEffect(() => {
    clearRoleError();
    clearRemoveError();
  }, [team, clearRoleError, clearRemoveError]);

  return (
    <section>
      <h2>Members</h2>
      <ErrorText error={setRole.error ?? remove.error} />
      <ul className="list">
        {team.members.map((member) => (
          <li key={member.id} className="list-row">
            <Avatar name={member.name} url={member.avatarUrl} size={32} />
            <Link className="grow" to={`/people/${member.id}`}>
              {member.name}
              {member.id === me.id && <span className="muted"> (you)</span>}
            </Link>
            {member.deactivated && <span className="tag warn">Deactivated</span>}
            {team.canManage ? (
              <>
                <select
                  className="input compact"
                  aria-label={`Role of ${member.name}`}
                  value={member.role}
                  onChange={(e) => setRole.mutate({ userId: member.id, role: e.target.value as Role })}
                >
                  <option value="MEMBER">Member</option>
                  <option value="TEAM_LEADER">TeamLeader</option>
                </select>
                {member.id !== me.id && (
                  <button
                    className="btn ghost small"
                    onClick={() => {
                      if (window.confirm(`Remove ${member.name} from ${team.name}?`)) remove.mutate(member.id);
                    }}
                  >
                    Remove
                  </button>
                )}
              </>
            ) : (
              <span className="tag">{roleLabel(member.role)}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function TeamDetailPage() {
  const me = useMe();
  const { id = '' } = useParams();
  const [editing, setEditing] = useState(false);
  const key = ['teams', id];
  const query = useQuery({ queryKey: key, queryFn: () => api<TeamDetail>(`/teams/${id}`) });

  const refresh = [key, ['me'], ['invitations']];
  const follow = useAction((on: boolean) => api(`/teams/${id}/follow`, { method: on ? 'PUT' : 'DELETE' }), [key, ['users', me.id]]);
  const requestJoin = useAction(() => api(`/teams/${id}/join-requests`, { method: 'POST' }), refresh);
  const cancelJoin = useAction(
    (requestId: string) => api(`/teams/${id}/join-requests/${requestId}`, { method: 'DELETE' }),
    refresh,
  );
  const accept = useAction(
    (invitationId: string) => api(`/invitations/${invitationId}/accept`, { method: 'POST' }),
    refresh,
  );
  const leave = useAction(() => api(`/teams/${id}/leave`, { method: 'POST' }), refresh);

  if (query.isPending) return <p className="muted">Loading…</p>;
  if (query.isError) return <ErrorText error={query.error} />;
  const team = query.data;

  return (
    <>
      <div className="profile-head">
        <Avatar name={team.name} url={team.avatarUrl} size={72} />
        <div className="grow">
          <h1>{team.name}</h1>
          {team.slogan && <p className="muted">{team.slogan}</p>}
        </div>
        <div className="row">
          <button className="btn" onClick={() => follow.mutate(!team.isFollowing)}>
            {team.isFollowing ? 'Following' : 'Follow'}
          </button>
          {team.canManage && !editing && (
            <button className="btn" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
          {team.myRole && (
            <button
              className="btn ghost"
              onClick={() => {
                if (window.confirm(`Leave ${team.name}?`)) leave.mutate();
              }}
            >
              Leave team
            </button>
          )}
          {!team.myRole && !me.isAdmin && team.myInvitationId && (
            <button className="btn primary" onClick={() => accept.mutate(team.myInvitationId!)}>
              Accept invitation
            </button>
          )}
          {!team.myRole && !me.isAdmin && !team.myInvitationId && !team.myJoinRequestId && (
            <button className="btn primary" onClick={() => requestJoin.mutate()}>
              Request to join
            </button>
          )}
          {team.myJoinRequestId && (
            <button className="btn" onClick={() => cancelJoin.mutate(team.myJoinRequestId!)}>
              Cancel join request
            </button>
          )}
        </div>
      </div>
      <ErrorText error={leave.error ?? requestJoin.error ?? cancelJoin.error ?? accept.error} />
      {editing && <EditTeam team={team} onDone={() => setEditing(false)} />}
      <Members team={team} />
      {team.canManage && <ManagePanel team={team} />}
    </>
  );
}

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type Page, type Profile, type ResetLink, type UserListItem } from '../api';
import { useMe } from '../auth';
import { Avatar, ErrorText, PageHeader, ResetLinkBox, roleLabel, useAction } from '../components/ui';

export function People() {
  const [q, setQ] = useState('');
  const people = useQuery({
    queryKey: ['users', 'directory', q],
    queryFn: () => api<Page<UserListItem>>(`/users?pageSize=100&q=${encodeURIComponent(q)}`),
  });
  return (
    <>
      <PageHeader title="People" subtitle={people.data ? `${people.data.total} people` : undefined} />
      <input className="input search" placeholder="Search by name" aria-label="Search people" value={q} onChange={(e) => setQ(e.target.value)} />
      <ErrorText error={people.error} />
      <ul className="list">
        {people.data?.items.map((person) => (
          <li key={person.id} className="list-row">
            <Avatar name={person.name} url={person.avatarUrl} />
            <div className="grow">
              <Link to={`/people/${person.id}`}>{person.name}</Link>
              {person.slogan && <div className="muted small">{person.slogan}</div>}
            </div>
            {person.status && person.status !== 'ACTIVE' && <span className="tag warn">{person.status.toLowerCase()}</span>}
          </li>
        ))}
      </ul>
    </>
  );
}

export function PersonDetail() {
  const me = useMe();
  const { id = '' } = useParams();
  const [link, setLink] = useState<ResetLink | null>(null);
  const profile = useQuery({ queryKey: ['users', id], queryFn: () => api<Profile>(`/users/${id}`) });
  const follow = useAction(
    (on: boolean) => api(`/users/${id}/follow`, { method: on ? 'PUT' : 'DELETE' }),
    [['users', id], ['users', me.id]],
  );
  const issue = useAction(async () => setLink(await api<ResetLink>(`/users/${id}/reset-link`, { method: 'POST' })));

  if (profile.isPending) return <p className="muted">Loading…</p>;
  if (profile.isError) return <ErrorText error={profile.error} />;
  const person = profile.data;

  return (
    <>
      <div className="profile-head">
        <Avatar name={person.name} url={person.avatarUrl} size={72} />
        <div className="grow">
          <h1>{person.name}</h1>
          {person.slogan && <p className="muted">{person.slogan}</p>}
          <div className="row">
            {person.isAdmin && <span className="tag">Admin</span>}
            {person.deactivated && <span className="tag warn">Deactivated</span>}
            {person.email && <span className="muted small">{person.email}</span>}
          </div>
        </div>
        {person.id === me.id ? (
          <Link className="btn" to="/profile">
            Edit profile
          </Link>
        ) : (
          <button className="btn" onClick={() => follow.mutate(!person.isFollowing)}>
            {person.isFollowing ? 'Following' : 'Follow'}
          </button>
        )}
      </div>

      {person.canIssueResetLink && !link && (
        <section>
          <button className="btn" disabled={issue.isPending} onClick={() => issue.mutate()}>
            Issue password reset link
          </button>
          <ErrorText error={issue.error} />
        </section>
      )}
      {link && <ResetLinkBox link={link} onClose={() => setLink(null)} />}

      <section>
        <div className="row">
          <Link to={`/work-log?user=${person.id}`}>View work log</Link>
          <Link to={`/activity/entries?user=${person.id}`}>View activity time</Link>
        </div>
      </section>

      <section>
        <h2>Teams</h2>
        {person.teams.length === 0 && <p className="muted">Not on a team.</p>}
        <ul className="list">
          {person.teams.map((team) => (
            <li key={team.id} className="list-row">
              <Avatar name={team.name} url={team.avatarUrl} size={32} />
              <Link className="grow" to={`/teams/${team.id}`}>
                {team.name}
              </Link>
              <span className="tag">{roleLabel(team.role)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="columns">
        <div>
          <h2>Following people</h2>
          {person.followingUsers.length === 0 && <p className="muted">Nobody yet.</p>}
          <ul className="plain">
            {person.followingUsers.map((user) => (
              <li key={user.id}>
                <Link to={`/people/${user.id}`}>{user.name}</Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2>Following teams</h2>
          {person.followingTeams.length === 0 && <p className="muted">No teams yet.</p>}
          <ul className="plain">
            {person.followingTeams.map((team) => (
              <li key={team.id}>
                <Link to={`/teams/${team.id}`}>{team.name}</Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}

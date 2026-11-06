import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, type Invitation, type PostListPage } from '../api';
import { useMe } from '../auth';
import { Avatar, ErrorText, PageHeader, roleLabel, useAction } from '../components/ui';

export function Home() {
  const me = useMe();
  const invitations = useQuery({ queryKey: ['invitations'], queryFn: () => api<Invitation[]>('/invitations') });
  const news = useQuery({
    queryKey: ['posts', 'NEWS', 'latest'],
    queryFn: () => api<PostListPage>('/posts?kind=NEWS&pageSize=3'),
  });
  const respond = useAction(
    ({ id, answer }: { id: string; answer: 'accept' | 'decline' }) =>
      api(`/invitations/${id}/${answer}`, { method: 'POST' }),
    [['invitations'], ['me'], ['teams']],
  );

  return (
    <>
      <PageHeader title={`Hello, ${me.name}`} subtitle={me.isAdmin ? 'You are the Admin.' : me.slogan} />

      {invitations.data && invitations.data.length > 0 && (
        <section>
          <h2>Invitations</h2>
          <ErrorText error={respond.error} />
          <ul className="list">
            {invitations.data.map((invitation) => (
              <li key={invitation.id} className="list-row">
                <Avatar name={invitation.team.name} url={invitation.team.avatarUrl} />
                <div className="grow">
                  <Link to={`/teams/${invitation.team.id}`}>{invitation.team.name}</Link>
                  <div className="muted small">Invited by {invitation.invitedBy}</div>
                </div>
                <button className="btn primary small" onClick={() => respond.mutate({ id: invitation.id, answer: 'accept' })}>
                  Accept
                </button>
                <button className="btn small" onClick={() => respond.mutate({ id: invitation.id, answer: 'decline' })}>
                  Decline
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {news.data && news.data.items.length > 0 && (
        <section>
          <div className="section-head">
            <h2>Latest news</h2>
            <Link to="/news">All news</Link>
          </div>
          <ul className="list">
            {news.data.items.map((post) => (
              <li key={post.id} className="list-row">
                <Link className="grow" to={`/posts/${post.id}`}>
                  {post.title}
                </Link>
                <span className="muted small">{new Date(post.createdAt).toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!me.isAdmin && (
        <section>
          <h2>Your teams</h2>
          {me.teams.length === 0 ? (
            <div className="empty">
              <p>You aren't on a team yet.</p>
              <Link className="btn primary" to="/teams">
                Browse teams
              </Link>
            </div>
          ) : (
            <ul className="list">
              {me.teams.map((team) => (
                <li key={team.id} className="list-row">
                  <Avatar name={team.name} url={team.avatarUrl} />
                  <Link className="grow" to={`/teams/${team.id}`}>
                    {team.name}
                  </Link>
                  <span className="tag">{roleLabel(team.role)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}

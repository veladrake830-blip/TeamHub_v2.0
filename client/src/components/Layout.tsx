import { useMutation, useQueryClient } from '@tanstack/react-query';
import { NavLink, Outlet } from 'react-router-dom';
import { api } from '../api';
import { useAuth, useMe } from '../auth';
import { Avatar } from './ui';

function ResetNotice() {
  const me = useMe();
  const client = useQueryClient();
  const dismiss = useMutation({
    mutationFn: () => api('/auth/me/dismiss-reset-notice', { method: 'POST' }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['me'] }),
  });
  if (!me.passwordResetNoticeAt) return null;
  return (
    <div className="notice" role="alert">
      <div>
        <strong>Your password was reset through a one-time link</strong> on{' '}
        {new Date(me.passwordResetNoticeAt).toLocaleString()}. If this wasn't you, tell the Admin straight away.
      </div>
      <button className="btn small" onClick={() => dismiss.mutate()}>
        Dismiss
      </button>
    </div>
  );
}

export function Layout() {
  const { logout } = useAuth();
  const me = useMe();
  const count = me.pendingInvitations;
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">TeamHub</div>
        <nav aria-label="Main">
          <NavLink to="/" end>
            Home
            {count > 0 && <span className="badge" aria-label={`${count} pending invitations`}>{count}</span>}
          </NavLink>
          <NavLink to="/teams">Teams</NavLink>
          <NavLink to="/people">People</NavLink>
          <NavLink to="/work-log">Work log</NavLink>
          <NavLink to="/activity">Activity</NavLink>
          <NavLink to="/news">News</NavLink>
          <NavLink to="/forum">Forum</NavLink>
          {me.isAdmin && (
            <>
              <NavLink to="/admin" end>
                Dashboard
              </NavLink>
              <NavLink to="/admin/accounts">Accounts</NavLink>
              <NavLink to="/admin/audit">Audit log</NavLink>
              <NavLink to="/admin/settings">Settings</NavLink>
            </>
          )}
        </nav>
        <div className="sidebar-foot">
          <NavLink to="/profile" className="me-link">
            <Avatar name={me.name} url={me.avatarUrl} size={32} />
            <span className="truncate">{me.name}</span>
          </NavLink>
          <button className="btn ghost small" onClick={() => void logout()}>
            Log out
          </button>
        </div>
      </aside>
      <main className="content">
        <ResetNotice />
        <Outlet />
      </main>
    </div>
  );
}

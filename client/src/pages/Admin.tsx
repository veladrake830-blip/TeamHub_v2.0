import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  type AdminSummary,
  type AuditEntry,
  type AuditPage,
  type OrganizationSettings,
  type Page,
  type ResetLink,
  type UserListItem,
} from '../api';
import { Avatar, ErrorText, Field, PageHeader, ResetLinkBox, useAction } from '../components/ui';

const ADMIN_KEYS = [['admin'], ['users']];

const actionLabel = (action: string) => {
  const text = action.replaceAll('_', ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

function detailText(details: unknown) {
  if (!details || typeof details !== 'object') return '';
  return Object.entries(details)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(', ');
}

function targetLink(entry: AuditEntry) {
  if (!entry.targetId) return null;
  const label = entry.targetName ?? entry.targetId;
  if (entry.targetType === 'User') return <Link to={`/people/${entry.targetId}`}>{label}</Link>;
  if (entry.targetType === 'Team') return <Link to={`/teams/${entry.targetId}`}>{label}</Link>;
  return label;
}

function AuditTable({ entries, showDetails = true }: { entries: AuditEntry[]; showDetails?: boolean }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">Who</th>
            <th scope="col">Action</th>
            <th scope="col">Target</th>
            {showDetails && <th scope="col">Details</th>}
            {showDetails && <th scope="col">IP</th>}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td className="nowrap">{new Date(entry.createdAt).toLocaleString()}</td>
              <td>{entry.actorName ?? <span className="muted">System</span>}</td>
              <td>{actionLabel(entry.action)}</td>
              <td>{targetLink(entry)}</td>
              {showDetails && <td className="muted small wrap">{detailText(entry.details)}</td>}
              {showDetails && <td className="muted small nowrap">{entry.ip}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AdminDashboard() {
  const summary = useQuery({ queryKey: ['admin', 'summary'], queryFn: () => api<AdminSummary>('/admin/summary') });
  const decide = useAction(
    ({ id, verb }: { id: string; verb: 'activate' | 'deactivate' }) => api(`/users/${id}/${verb}`, { method: 'POST' }),
    ADMIN_KEYS,
  );

  if (summary.isPending) return <p className="muted">Loading…</p>;
  if (summary.isError) return <ErrorText error={summary.error} />;
  const { counts, pending, leaderlessTeams, recentActivity } = summary.data;

  return (
    <>
      <PageHeader title="Admin dashboard" />
      <dl className="stats">
        <div>
          <dt>Active accounts</dt>
          <dd>{counts.active}</dd>
        </div>
        <div>
          <dt>Waiting for activation</dt>
          <dd>{counts.pending}</dd>
        </div>
        <div>
          <dt>Deactivated</dt>
          <dd>{counts.deactivated}</dd>
        </div>
        <div>
          <dt>Teams</dt>
          <dd>{counts.teams}</dd>
        </div>
      </dl>

      {leaderlessTeams.length > 0 && (
        <section>
          <h2>Teams with no active TeamLeader</h2>
          <ul className="list">
            {leaderlessTeams.map((team) => (
              <li key={team.id} className="list-row">
                <Link className="grow" to={`/teams/${team.id}`}>
                  {team.name}
                </Link>
                <Link className="btn small" to={`/teams/${team.id}`}>
                  Appoint a leader
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2>Waiting for activation</h2>
        <ErrorText error={decide.error} />
        {pending.length === 0 ? (
          <p className="muted">No accounts are waiting.</p>
        ) : (
          <ul className="list">
            {pending.map((user) => (
              <li key={user.id} className="list-row">
                <div className="grow">
                  {user.name}
                  <div className="muted small">
                    {user.email}, registered {new Date(user.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <button className="btn primary small" onClick={() => decide.mutate({ id: user.id, verb: 'activate' })}>
                  Activate
                </button>
                <button className="btn small" onClick={() => decide.mutate({ id: user.id, verb: 'deactivate' })}>
                  Decline
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="section-head">
          <h2>Recent activity</h2>
          <Link to="/admin/audit">View audit log</Link>
        </div>
        <AuditTable entries={recentActivity} showDetails={false} />
      </section>
    </>
  );
}

function AddAccount({ onCreated, onCancel }: { onCreated(link: ResetLink): void; onCancel(): void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const add = useAction(async () => {
    const created = await api<{ firstPasswordLink: ResetLink }>('/users', { method: 'POST', body: { name, email } });
    onCreated(created.firstPasswordLink);
  }, ADMIN_KEYS);
  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        add.mutate();
      }}
    >
      <h2>Add account</h2>
      <Field label="Name">
        <input className="input" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Email">
        <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <p className="muted small">The account is active straight away. You'll get a one-time link for the user to set their password.</p>
      <ErrorText error={add.error} />
      <div className="row">
        <button className="btn primary" disabled={add.isPending}>
          Add account
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function EditAccount({ user, onDone }: { user: UserListItem; onDone(): void }) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email ?? '');
  const [slogan, setSlogan] = useState(user.slogan);
  const save = useAction(
    () => api(`/users/${user.id}`, { method: 'PATCH', body: { name, email, slogan } }).then(onDone),
    ADMIN_KEYS,
  );
  return (
    <form
      className="edit-row"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Field label="Name">
        <input className="input" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Email">
        <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Slogan">
        <input className="input" maxLength={200} value={slogan} onChange={(e) => setSlogan(e.target.value)} />
      </Field>
      <ErrorText error={save.error} />
      <div className="row">
        <button className="btn primary small" disabled={save.isPending}>
          Save
        </button>
        <button type="button" className="btn small" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

const PAGE_SIZE = 30;

export function AdminAccounts({ adminId }: { adminId: string }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [link, setLink] = useState<ResetLink | null>(null);

  const params = new URLSearchParams({ q, page: String(page), pageSize: String(PAGE_SIZE) });
  if (status) params.set('status', status);
  const accounts = useQuery({
    queryKey: ['users', 'accounts', q, status, page],
    queryFn: () => api<Page<UserListItem>>(`/users?${params}`),
  });
  const setActive = useAction(
    ({ id, verb }: { id: string; verb: 'activate' | 'deactivate' }) => api(`/users/${id}/${verb}`, { method: 'POST' }),
    ADMIN_KEYS,
  );
  const issue = useAction(async (id: string) => setLink(await api<ResetLink>(`/users/${id}/reset-link`, { method: 'POST' })));

  const total = accounts.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageHeader
        title="Accounts"
        subtitle={accounts.data ? `${total} accounts` : undefined}
        actions={
          !adding ? (
            <button className="btn primary" onClick={() => setAdding(true)}>
              Add account
            </button>
          ) : undefined
        }
      />
      {adding && (
        <AddAccount
          onCancel={() => setAdding(false)}
          onCreated={(created) => {
            setAdding(false);
            setLink(created);
          }}
        />
      )}
      {link && <ResetLinkBox link={link} onClose={() => setLink(null)} />}

      <div className="row filters">
        <input
          className="input search"
          placeholder="Search by name"
          aria-label="Search accounts"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <select
          className="input auto"
          aria-label="Filter by status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="ACTIVE">Active</option>
          <option value="DEACTIVATED">Deactivated</option>
        </select>
      </div>
      <ErrorText error={accounts.error ?? setActive.error ?? issue.error} />

      <ul className="list">
        {accounts.data?.items.map((user) =>
          editingId === user.id ? (
            <li key={user.id} className="list-row">
              <EditAccount user={user} onDone={() => setEditingId(null)} />
            </li>
          ) : (
            <li key={user.id} className="list-row">
              <Avatar name={user.name} url={user.avatarUrl} size={32} />
              <div className="grow">
                <Link to={`/people/${user.id}`}>{user.name}</Link>
                <div className="muted small truncate">{user.email}</div>
              </div>
              {user.status !== 'ACTIVE' && <span className="tag warn">{user.status?.toLowerCase()}</span>}
              {user.id === adminId ? (
                <span className="tag">Admin</span>
              ) : (
                <>
                  <button className="btn ghost small" onClick={() => setEditingId(user.id)}>
                    Edit
                  </button>
                  {user.status === 'ACTIVE' && (
                    <button className="btn ghost small" disabled={issue.isPending} onClick={() => issue.mutate(user.id)}>
                      Reset link
                    </button>
                  )}
                  {user.status === 'ACTIVE' ? (
                    <button
                      className="btn small"
                      onClick={() => {
                        if (window.confirm(`Deactivate ${user.name}? They will be logged out immediately.`)) {
                          setActive.mutate({ id: user.id, verb: 'deactivate' });
                        }
                      }}
                    >
                      Deactivate
                    </button>
                  ) : (
                    <button className="btn small" onClick={() => setActive.mutate({ id: user.id, verb: 'activate' })}>
                      {user.status === 'PENDING' ? 'Activate' : 'Reactivate'}
                    </button>
                  )}
                </>
              )}
            </li>
          ),
        )}
      </ul>

      {pages > 1 && (
        <div className="row pager">
          <button className="btn small" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span className="muted small">
            Page {page} of {pages}
          </span>
          <button className="btn small" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </div>
      )}
    </>
  );
}

export function AdminSettings() {
  const settings = useQuery({
    queryKey: ['admin', 'organization'],
    queryFn: () => api<OrganizationSettings>('/settings/organization'),
  });
  const [choice, setChoice] = useState<string | null>(null);
  const timezone = choice ?? settings.data?.timezone ?? '';
  const save = useAction(
    () => api('/settings/organization', { method: 'PUT', body: { timezone } }),
    [['admin'], ['work-logs']],
  );
  const zones = Intl.supportedValuesOf('timeZone');
  const options = zones.includes(timezone) || !timezone ? zones : [timezone, ...zones];

  return (
    <>
      <PageHeader title="Organization settings" />
      <form
        className="card narrow"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field
          label="Timezone"
          hint="Sets when each day starts and ends for everyone, including Work Log deadlines. A change applies immediately."
        >
          <select className="input" value={timezone} onChange={(e) => setChoice(e.target.value)}>
            {options.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </Field>
        <ErrorText error={settings.error ?? save.error} />
        {save.isSuccess && <p className="success" role="status">Saved.</p>}
        <button className="btn primary" disabled={save.isPending || !timezone}>
          Save
        </button>
      </form>
    </>
  );
}

/** Turns a date input's value into the start of that day in the viewer's timezone. */
const dayStart = (value: string, addDays = 0) => {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + addDays);
  return date.toISOString();
};

export function AdminAudit() {
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const actions = useQuery({ queryKey: ['admin', 'actions'], queryFn: () => api<string[]>('/admin/audit/actions') });
  const log = useInfiniteQuery({
    queryKey: ['admin', 'audit', action, actor, from, to],
    initialPageParam: null as string | null,
    getNextPageParam: (last: AuditPage) => last.nextBefore,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (action) params.set('action', action);
      if (actor) params.set('actor', actor);
      if (from) params.set('from', dayStart(from));
      if (to) params.set('to', dayStart(to, 1));
      if (pageParam) params.set('before', pageParam);
      return api<AuditPage>(`/admin/audit?${params}`);
    },
  });
  const entries = log.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <PageHeader title="Audit log" subtitle="Entries can't be edited or deleted." />
      <div className="row filters">
        <select className="input auto" aria-label="Filter by action" value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">All actions</option>
          {actions.data?.map((name) => (
            <option key={name} value={name}>
              {actionLabel(name)}
            </option>
          ))}
        </select>
        <input className="input auto" placeholder="Who" aria-label="Filter by person" value={actor} onChange={(e) => setActor(e.target.value)} />
        <label className="inline">
          From
          <input className="input auto" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="inline">
          To
          <input className="input auto" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <ErrorText error={log.error} />
      {log.isSuccess && entries.length === 0 && <div className="empty">No matching entries.</div>}
      {entries.length > 0 && <AuditTable entries={entries} />}
      {log.hasNextPage && (
        <div className="row pager">
          <button className="btn" disabled={log.isFetchingNextPage} onClick={() => void log.fetchNextPage()}>
            Load more
          </button>
        </div>
      )}
    </>
  );
}

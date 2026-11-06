import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, type Page, type ResetLink, type UserListItem } from '../api';

export function Avatar({ name, url, size = 40 }: { name: string; url: string | null; size?: number }) {
  const style = { width: size, height: size, fontSize: size * 0.4 };
  if (url) return <img className="avatar" src={url} alt="" style={style} />;
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('');
  return (
    <span className="avatar placeholder" style={style} aria-hidden="true">
      {initials}
    </span>
  );
}

export const ErrorText = ({ error }: { error: unknown }) =>
  error ? <p className="error" role="alert">{error instanceof Error ? error.message : 'Something went wrong.'}</p> : null;

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </header>
  );
}

export const roleLabel = (role: string) => (role === 'TEAM_LEADER' ? 'TeamLeader' : 'Member');

/** Runs an API call, then refreshes the listed queries. Failures are returned for display. */
export function useAction<V = void>(run: (value: V) => Promise<unknown>, invalidate: QueryKey[] = []) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => Promise.all(invalidate.map((queryKey) => client.invalidateQueries({ queryKey }))),
  });
}

/** Shown once, because only a hash is stored. */
export function ResetLinkBox({ link, onClose }: { link: ResetLink; onClose(): void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="card highlight">
      <h3>One-time password link</h3>
      <p className="muted">
        Pass this to the user directly. It works once and expires on {new Date(link.expiresAt).toLocaleString()}. It
        won't be shown again.
      </p>
      <input className="input mono" readOnly value={link.url} onFocus={(e) => e.target.select()} aria-label="Reset link" />
      <div className="row">
        <button
          className="btn primary"
          onClick={() => void navigator.clipboard.writeText(link.url).then(() => setCopied(true))}
        >
          {copied ? 'Copied' : 'Copy link'}
        </button>
        <button className="btn" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

/** Search box that finds an active user. */
export function UserPicker({
  label,
  onPick,
  exclude = [],
}: {
  label: string;
  onPick(user: UserListItem): void;
  exclude?: string[];
}) {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const timer = useRef<number>(undefined);

  useEffect(() => {
    timer.current = window.setTimeout(() => setQuery(text.trim()), 200);
    return () => window.clearTimeout(timer.current);
  }, [text]);

  const results = useQuery({
    queryKey: ['users', 'picker', query],
    queryFn: () => api<Page<UserListItem>>(`/users?status=ACTIVE&pageSize=8&q=${encodeURIComponent(query)}`),
    enabled: query.length > 0,
  });
  const items = results.data?.items.filter((u) => !exclude.includes(u.id)) ?? [];

  return (
    <div className="picker">
      <Field label={label}>
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search by name" />
      </Field>
      {query && (
        <ul className="picker-list">
          {items.map((user) => (
            <li key={user.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(user);
                  setText('');
                  setQuery('');
                }}
              >
                <Avatar name={user.name} url={user.avatarUrl} size={24} />
                {user.name}
              </button>
            </li>
          ))}
          {results.isSuccess && items.length === 0 && <li className="muted pad">No matching people.</li>}
        </ul>
      )}
    </div>
  );
}

import { useState } from 'react';
import { api } from '../api';
import { useMe } from '../auth';
import { Avatar, ErrorText, Field, PageHeader, useAction } from '../components/ui';
import { applyTheme, type Theme } from '../theme';

function AvatarForm() {
  const me = useMe();
  const upload = useAction(
    (file: File) => {
      const form = new FormData();
      form.append('avatar', file);
      return api('/users/me/avatar', { method: 'PUT', form });
    },
    [['me']],
  );
  const remove = useAction(() => api('/users/me/avatar', { method: 'DELETE' }), [['me']]);
  return (
    <section className="card">
      <h2>Avatar</h2>
      <div className="row">
        <Avatar name={me.name} url={me.avatarUrl} size={64} />
        <label className="btn">
          Upload image
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
        {me.avatarUrl && (
          <button className="btn ghost" onClick={() => remove.mutate()}>
            Remove
          </button>
        )}
      </div>
      <p className="muted small">PNG, JPEG or WebP, up to 2 MB.</p>
      <ErrorText error={upload.error ?? remove.error} />
    </section>
  );
}

function DetailsForm() {
  const me = useMe();
  const [form, setForm] = useState({ name: me.name, slogan: me.slogan, email: me.email, currentPassword: '' });
  const emailChanged = form.email.trim().toLowerCase() !== me.email;
  const save = useAction(
    () =>
      api('/users/me', {
        method: 'PATCH',
        body: {
          name: form.name,
          slogan: form.slogan,
          ...(emailChanged ? { email: form.email, currentPassword: form.currentPassword } : {}),
        },
      }).then(() => setForm((f) => ({ ...f, currentPassword: '' }))),
    [['me'], ['users']],
  );
  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <h2>Details</h2>
      <Field label="Name">
        <input className="input" required maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <Field label="Slogan">
        <input className="input" maxLength={200} value={form.slogan} onChange={(e) => setForm({ ...form, slogan: e.target.value })} />
      </Field>
      <Field label="Email" hint="You log in with this address.">
        <input className="input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </Field>
      {emailChanged && (
        <Field label="Current password" hint="Required to change your email.">
          <input className="input" type="password" autoComplete="current-password" required value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />
        </Field>
      )}
      <ErrorText error={save.error} />
      {save.isSuccess && <p className="success" role="status">Saved.</p>}
      <button className="btn primary" disabled={save.isPending}>
        Save changes
      </button>
    </form>
  );
}

const THEMES: { value: Theme; label: string }[] = [
  { value: 'SYSTEM', label: 'Match this device' },
  { value: 'LIGHT', label: 'Light' },
  { value: 'DARK', label: 'Dark' },
];

function AppearanceForm() {
  const me = useMe();
  const save = useAction(
    (theme: Theme) => {
      applyTheme(theme);
      return api('/users/me/preferences', { method: 'PUT', body: { theme } });
    },
    [['me']],
  );
  return (
    <section className="card">
      <h2>Appearance</h2>
      <div className="segmented" role="group" aria-label="Theme">
        {THEMES.map(({ value, label }) => (
          <button key={value} className={me.theme === value ? 'on' : ''} aria-pressed={me.theme === value} onClick={() => save.mutate(value)}>
            {label}
          </button>
        ))}
      </div>
      <ErrorText error={save.error} />
    </section>
  );
}

function PasswordForm() {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' });
  const save = useAction(
    () => api('/users/me/password', { method: 'PUT', body: form }).then(() => setForm({ currentPassword: '', newPassword: '' })),
  );
  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <h2>Password</h2>
      <Field label="Current password">
        <input className="input" type="password" autoComplete="current-password" required value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />
      </Field>
      <Field label="New password" hint="At least 8 characters. Your other devices will be logged out.">
        <input className="input" type="password" autoComplete="new-password" required minLength={8} value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />
      </Field>
      <ErrorText error={save.error} />
      {save.isSuccess && <p className="success" role="status">Password changed.</p>}
      <button className="btn primary" disabled={save.isPending}>
        Change password
      </button>
    </form>
  );
}

export function ProfileSettings() {
  return (
    <>
      <PageHeader title="Your profile" />
      <div className="stack">
        <AvatarForm />
        <AppearanceForm />
        <DetailsForm />
        <PasswordForm />
      </div>
    </>
  );
}

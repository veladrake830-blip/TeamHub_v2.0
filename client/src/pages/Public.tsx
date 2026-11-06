import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { ErrorText, Field } from '../components/ui';

function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="brand">TeamHub</div>
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  );
}

export function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const submit = useMutation({ mutationFn: () => login(email, password) });
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit.mutate();
  };
  return (
    <AuthCard title="Log in">
      <form onSubmit={onSubmit}>
        <Field label="Email">
          <input className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <ErrorText error={submit.error} />
        <button className="btn primary wide" disabled={submit.isPending}>
          {submit.isPending ? 'Logging in…' : 'Log in'}
        </button>
      </form>
      <p className="muted">
        New here? <Link to="/register">Create an account</Link>
      </p>
      <p className="muted small">Forgot your password? Ask a TeamLeader or the Admin for a reset link.</p>
    </AuthCard>
  );
}

export function Register() {
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const submit = useMutation({ mutationFn: () => api('/auth/register', { method: 'POST', body: form }) });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: e.target.value });

  if (submit.isSuccess) {
    return (
      <AuthCard title="Account created">
        <p>Your account is waiting for the Admin to activate it. You can log in once that's done.</p>
        <Link className="btn wide" to="/login">
          Back to login
        </Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Create an account">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit.mutate();
        }}
      >
        <Field label="Name">
          <input className="input" autoComplete="name" required maxLength={100} value={form.name} onChange={set('name')} />
        </Field>
        <Field label="Email">
          <input className="input" type="email" autoComplete="username" required value={form.email} onChange={set('email')} />
        </Field>
        <Field label="Password" hint="At least 8 characters.">
          <input className="input" type="password" autoComplete="new-password" required minLength={8} value={form.password} onChange={set('password')} />
        </Field>
        <ErrorText error={submit.error} />
        <button className="btn primary wide" disabled={submit.isPending}>
          Create account
        </button>
      </form>
      <p className="muted">
        Already registered? <Link to="/login">Log in</Link>
      </p>
    </AuthCard>
  );
}

export function ResetPassword() {
  const token = useLocation().hash.slice(1);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const check = useQuery({
    queryKey: ['reset-link', token],
    queryFn: () =>
      api<{ name: string; purpose: 'RESET' | 'FIRST_PASSWORD' }>('/auth/password-reset/check', {
        method: 'POST',
        body: { token },
      }),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const submit = useMutation({
    mutationFn: () => api('/auth/password-reset/complete', { method: 'POST', body: { token, password } }),
  });
  const mismatch = confirm.length > 0 && confirm !== password;

  if (submit.isSuccess) {
    return (
      <AuthCard title="Password set">
        <p>You can now log in with your new password.</p>
        <Link className="btn primary wide" to="/login">
          Go to login
        </Link>
      </AuthCard>
    );
  }
  if (check.isPending) return <div className="center muted">Checking link…</div>;
  if (check.isError) {
    return (
      <AuthCard title="Link not valid">
        <p>This link is invalid, was already used, or has expired. Ask a TeamLeader or the Admin for a new one.</p>
        <Link className="btn wide" to="/login">
          Back to login
        </Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard title={check.data.purpose === 'FIRST_PASSWORD' ? 'Set your password' : 'Choose a new password'}>
      <p className="muted">For {check.data.name}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!mismatch) submit.mutate();
        }}
      >
        <Field label="New password" hint="At least 8 characters.">
          <input className="input" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Repeat password">
          <input className="input" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        {mismatch && <p className="error">Passwords don't match.</p>}
        <ErrorText error={submit.error} />
        <button className="btn primary wide" disabled={submit.isPending || mismatch}>
          Save password
        </button>
      </form>
    </AuthCard>
  );
}

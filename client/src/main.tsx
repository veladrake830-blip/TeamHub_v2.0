import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { Layout } from './components/Layout';
import { ActivityDashboardPage, ActivityEntriesPage } from './pages/Activity';
import { AdminAccounts, AdminAudit, AdminDashboard, AdminSettings } from './pages/Admin';
import { Home } from './pages/Home';
import { Login, Register, ResetPassword } from './pages/Public';
import { People, PersonDetail } from './pages/People';
import { PostList, PostPage } from './pages/Posts';
import { ProfileSettings } from './pages/ProfileSettings';
import { TeamDetailPage, Teams } from './pages/Teams';
import { WorkLog } from './pages/WorkLog';
import { applyStoredTheme } from './theme';
import './styles.css';

applyStoredTheme();

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: true, staleTime: 5_000 } },
});

function Protected() {
  const { me, loading } = useAuth();
  if (loading) return <div className="center muted">Loading…</div>;
  if (!me) return <Navigate to="/login" replace />;
  return <Layout />;
}

/** Only hides the pages. The server enforces the rule on every Admin request. */
function AdminOnly({ page }: { page(adminId: string): React.ReactNode }) {
  const { me } = useAuth();
  if (!me?.isAdmin) return <Navigate to="/" replace />;
  return page(me.id);
}

function GuestOnly({ children }: { children: React.ReactNode }) {
  const { me, loading } = useAuth();
  if (loading) return <div className="center muted">Loading…</div>;
  if (me) return <Navigate to="/" replace />;
  return children;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
            <Route path="/register" element={<GuestOnly><Register /></GuestOnly>} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route element={<Protected />}>
              <Route index element={<Home />} />
              <Route path="teams" element={<Teams />} />
              <Route path="teams/:id" element={<TeamDetailPage />} />
              <Route path="people" element={<People />} />
              <Route path="people/:id" element={<PersonDetail />} />
              <Route path="profile" element={<ProfileSettings />} />
              <Route path="admin" element={<AdminOnly page={() => <AdminDashboard />} />} />
              <Route path="admin/accounts" element={<AdminOnly page={(id) => <AdminAccounts adminId={id} />} />} />
              <Route path="admin/audit" element={<AdminOnly page={() => <AdminAudit />} />} />
              <Route path="admin/settings" element={<AdminOnly page={() => <AdminSettings />} />} />
              <Route path="work-log" element={<WorkLog />} />
              <Route path="activity" element={<ActivityDashboardPage />} />
              <Route path="activity/entries" element={<ActivityEntriesPage />} />
              <Route path="news" element={<PostList key="news" kind="NEWS" />} />
              <Route path="forum" element={<PostList key="forum" kind="TOPIC" />} />
              <Route path="posts/:id" element={<PostPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);

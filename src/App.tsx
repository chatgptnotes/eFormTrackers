import { lazy, Suspense, useMemo } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import DirectorDashboard from './pages/DirectorDashboard';
import { useSubmissions } from './hooks/useSubmissions';
import ErrorBoundary from './components/ErrorBoundary';
import { Loader2 } from 'lucide-react';
import { ToastProvider } from './components/ToastNotification';
import { getUserConfig, isSubmissionVisible } from './config/currentUser';

// Lazy-loaded pages — only downloaded when the user navigates to them
const ModernDashboard = lazy(() => import('./pages/ModernDashboard'));
const WorkflowTracker = lazy(() => import('./pages/WorkflowTracker'));
const BottleneckAnalysis = lazy(() => import('./pages/BottleneckAnalysis'));
const ApprovalDetail = lazy(() => import('./pages/ApprovalDetail'));
const Settings = lazy(() => import('./pages/Settings'));
const LandingPage = lazy(() => import('./pages/LandingPage'));
const Login = lazy(() => import('./pages/Login'));
const Signup = lazy(() => import('./pages/Signup'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const Onboarding = lazy(() => import('./pages/Onboarding'));
const TeamManagement = lazy(() => import('./pages/TeamManagement'));
const OrgSettings = lazy(() => import('./pages/OrgSettings'));
const Billing = lazy(() => import('./pages/Billing'));
const Profile = lazy(() => import('./pages/Profile'));
const ActivityLog = lazy(() => import('./pages/ActivityLog'));
const HelpSupport = lazy(() => import('./pages/HelpSupport'));
const AdvancedAnalytics = lazy(() => import('./pages/AdvancedAnalytics'));
const KanbanBoard = lazy(() => import('./pages/KanbanBoard'));
const SubmitRequest = lazy(() => import('./pages/SubmitRequest'));
const CompletedPage = lazy(() => import('./pages/CompletedPage'));

function PageLoader() {
  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-8 h-8 text-gold animate-spin" />
    </div>
  );
}

function RoleGuard({ allowed, children }: { allowed: string[]; children: React.ReactNode }) {
  const { orgRole } = useAuth();
  if (!allowed.includes(orgRole)) return <Navigate to="/app/director" replace />;
  return <>{children}</>;
}

function ProtectedApp() {
  const data = useSubmissions();
  const { user, orgRole } = useAuth();
  const currentUser = getUserConfig(user?.email);

  const visibleForms = useMemo(() => {
    if (orgRole === 'super_admin' || currentUser.isAdmin) return data.activeForms;
    const visibleFormIds = new Set(
      data.allSubmissions
        .filter(s => isSubmissionVisible(s, user?.email, currentUser, orgRole))
        .map(s => s.formId)
    );
    return data.activeForms.filter(f => visibleFormIds.has(f.id));
  }, [data.activeForms, data.allSubmissions, user?.email, currentUser, orgRole]);

  return (
    <Layout refreshConfig={data.refreshConfig} setRefreshConfig={data.setRefreshConfig} onRefresh={data.refresh} activeForms={visibleForms} activeDepartments={[...new Set(data.allSubmissions.map(s => s.submittedBy.department).filter(Boolean))]}>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<DirectorDashboard data={data} />} />
          <Route path="/modern" element={<RoleGuard allowed={['super_admin', 'admin', 'approver']}><ModernDashboard data={data} /></RoleGuard>} />
          <Route path="/tracker" element={<RoleGuard allowed={['super_admin', 'admin', 'approver']}><WorkflowTracker data={data} /></RoleGuard>} />
          <Route path="/bottlenecks" element={<RoleGuard allowed={['super_admin', 'admin']}><BottleneckAnalysis data={data} /></RoleGuard>} />
          <Route path="/approval/:level" element={<RoleGuard allowed={['super_admin', 'admin', 'approver']}><ApprovalDetail data={data} /></RoleGuard>} />
          <Route path="/settings" element={<RoleGuard allowed={['super_admin', 'admin', 'approver']}><Settings /></RoleGuard>} />
          <Route path="/team" element={<RoleGuard allowed={['super_admin', 'admin']}><TeamManagement /></RoleGuard>} />
          <Route path="/org-settings" element={<RoleGuard allowed={['super_admin']}><OrgSettings /></RoleGuard>} />
          <Route path="/billing" element={<RoleGuard allowed={['super_admin']}><Billing /></RoleGuard>} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/activity" element={<RoleGuard allowed={['super_admin', 'admin']}><ActivityLog /></RoleGuard>} />
          <Route path="/help" element={<HelpSupport />} />
          <Route path="/analytics" element={<RoleGuard allowed={['super_admin', 'admin']}><AdvancedAnalytics data={data} /></RoleGuard>} />
          <Route path="/kanban" element={<RoleGuard allowed={['super_admin', 'admin', 'approver']}><KanbanBoard data={data} /></RoleGuard>} />
          <Route path="/director" element={<DirectorDashboard data={data} />} />
          <Route path="/submit-request" element={<SubmitRequest activeForms={data.activeForms} />} />
          <Route path="/completed" element={<CompletedPage data={data} />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen bg-navy-dark flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-gold animate-spin" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-navy-dark flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-gold animate-spin" />
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <ToastProvider>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<Navigate to="/app" replace />} />
          <Route path="/login" element={user ? <Navigate to="/app" replace /> : <Login />} />
          <Route path="/signup" element={user ? <Navigate to="/app" replace /> : <Signup />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/onboarding" element={<RequireAuth><Onboarding /></RequireAuth>} />
          <Route path="/app/*" element={<RequireAuth><ProtectedApp /></RequireAuth>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      </ToastProvider>
    </ErrorBoundary>
  );
}

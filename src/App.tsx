import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import DirectorDashboard from './pages/DirectorDashboard';
import { useSubmissions } from './hooks/useSubmissions';
import ErrorBoundary from './components/ErrorBoundary';
import { Loader2 } from 'lucide-react';

// Lazy-loaded pages — only downloaded when the user navigates to them
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

function PageLoader() {
  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-8 h-8 text-gold animate-spin" />
    </div>
  );
}

function ProtectedApp() {
  const data = useSubmissions();

  return (
    <Layout refreshConfig={data.refreshConfig} setRefreshConfig={data.setRefreshConfig} onRefresh={data.refresh} activeForms={data.activeForms}>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<DirectorDashboard data={data} />} />
          <Route path="/tracker" element={<WorkflowTracker data={data} />} />
          <Route path="/bottlenecks" element={<BottleneckAnalysis data={data} />} />
          <Route path="/approval/:level" element={<ApprovalDetail data={data} />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/team" element={<TeamManagement />} />
          <Route path="/org-settings" element={<OrgSettings />} />
          <Route path="/billing" element={<Billing />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/activity" element={<ActivityLog />} />
          <Route path="/help" element={<HelpSupport />} />
          <Route path="/analytics" element={<AdvancedAnalytics data={data} />} />
          <Route path="/kanban" element={<KanbanBoard data={data} />} />
          <Route path="/director" element={<DirectorDashboard data={data} />} />
          <Route path="/submit-request" element={<SubmitRequest activeForms={data.activeForms} />} />
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
    </ErrorBoundary>
  );
}

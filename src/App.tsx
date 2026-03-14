import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import WorkflowTracker from './pages/WorkflowTracker';
import BottleneckAnalysis from './pages/BottleneckAnalysis';
import ApprovalDetail from './pages/ApprovalDetail';
import Settings from './pages/Settings';
import LandingPage from './pages/LandingPage';
import Login from './pages/Login';
import Signup from './pages/Signup';
import ForgotPassword from './pages/ForgotPassword';
import Onboarding from './pages/Onboarding';
import TeamManagement from './pages/TeamManagement';
import OrgSettings from './pages/OrgSettings';
import Billing from './pages/Billing';
import Profile from './pages/Profile';
import ActivityLog from './pages/ActivityLog';
import HelpSupport from './pages/HelpSupport';
import AdvancedAnalytics from './pages/AdvancedAnalytics';
import KanbanBoard from './pages/KanbanBoard';
import DirectorDashboard from './pages/DirectorDashboard';
import SubmitRequest from './pages/SubmitRequest';
import { useSubmissions } from './hooks/useSubmissions';
import ErrorBoundary from './components/ErrorBoundary';
import { Loader2 } from 'lucide-react';

function ProtectedApp() {
  const data = useSubmissions();

  return (
    <Layout refreshConfig={data.refreshConfig} setRefreshConfig={data.setRefreshConfig} onRefresh={data.refresh} activeForms={data.activeForms}>
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
      <Routes>
        <Route path="/" element={<Navigate to="/app" replace />} />
        <Route path="/login" element={user ? <Navigate to="/app" replace /> : <Login />} />
        <Route path="/signup" element={user ? <Navigate to="/app" replace /> : <Signup />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/onboarding" element={<RequireAuth><Onboarding /></RequireAuth>} />
        <Route path="/app/*" element={<RequireAuth><ProtectedApp /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}

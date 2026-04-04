import { Routes, Route, Navigate } from 'react-router-dom';
import { useSession } from '@/lib/auth';
import AppLayout from '@/components/AppLayout';
import LoginPage from '@/pages/LoginPage';
import SignupPage from '@/pages/SignupPage';
import SubscribePage from '@/pages/SubscribePage';
import SubscribeSuccessPage from '@/pages/SubscribeSuccessPage';
import DashboardPage from '@/pages/DashboardPage';
import TripsPage from '@/pages/TripsPage';
import PaySummaryPage from '@/pages/PaySummaryPage';
import SettingsPage from '@/pages/SettingsPage';
import CareerPage from '@/pages/CareerPage';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = useSession();

  if (isPending) {
    return (
      <div className="flex items-center justify-center h-screen bg-navy-950">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-500">Loading...</p>
        </div>
      </div>
    );
  }

  if (!session?.user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/subscribe" element={<SubscribePage />} />
      <Route path="/subscribe/success" element={<SubscribeSuccessPage />} />
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/trips" element={<TripsPage />} />
        <Route path="/pay-summary" element={<PaySummaryPage />} />
        <Route path="/career" element={<CareerPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

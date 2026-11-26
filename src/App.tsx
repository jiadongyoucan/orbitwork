import { useEffect } from 'react';
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider } from '@/context/AuthContext';
import { ToastProvider } from '@/context/ToastContext';
import { AppShell } from '@/components/AppShell';
import Landing from '@/pages/Landing';
import { InvitePage, LoginPage, SignupPage } from '@/pages/Auth';
import HomePage from '@/pages/Home';
import ChatPage from '@/pages/Chat';
import AgentsPage from '@/pages/Agents';
import { ConnectorsPage, ExpertsPage, SkillsPage } from '@/pages/Assets';
import MarketPage from '@/pages/Market';
import MemoriesPage from '@/pages/Memories';
import FilesPage from '@/pages/Files';
import SandboxPage from '@/pages/Sandbox';
import SettingsPage from '@/pages/Settings';
import ModelsPage from '@/pages/Models';
import AdminPage from '@/pages/Admin';
import { EmptyState, PageHeader } from '@/components/UI';

function ScrollToTop() {
  const location = useLocation();
  useEffect(() => {
    document.querySelector('.main-scroll')?.scrollTo({ top: 0 });
    if (!location.pathname.startsWith('/app/c/')) window.scrollTo({ top: 0 });
  }, [location.pathname]);
  return null;
}

function NotFound() {
  return (
    <div style={{ minHeight: '70vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <EmptyState
        icon={<span style={{ fontSize: 18 }}>404</span>}
        title="这个轨道上没有内容"
        description="页面可能已被移除，或者链接不正确。"
        action={<Link className="btn btn-primary btn-sm" to="/app">返回工作台</Link>}
      />
    </div>
  );
}

function ConsoleLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <ScrollToTop />
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/invite/:token" element={<InvitePage />} />
            <Route path="/app" element={<ConsoleLayout />}>
              <Route index element={<HomePage />} />
              <Route path="c/:chatId" element={<ChatPage />} />
              <Route path="agents" element={<AgentsPage />} />
              <Route path="experts" element={<ExpertsPage />} />
              <Route path="skills" element={<SkillsPage />} />
              <Route path="connectors" element={<ConnectorsPage />} />
              <Route path="market" element={<MarketPage />} />
              <Route path="memories" element={<MemoriesPage />} />
              <Route path="files" element={<FilesPage />} />
              <Route path="sandbox" element={<SandboxPage />} />
              <Route path="members" element={<Navigate to="/app/settings?tab=members" replace />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="models" element={<ModelsPage />} />
              <Route path="admin" element={<AdminPage />} />
            </Route>
            <Route path="/app/*" element={<Navigate to="/app" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

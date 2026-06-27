// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { DashboardLayout } from './components/layout/DashboardLayout';
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage';
import { OAuthCallbackPage } from './pages/auth/OAuthCallbackPage';
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage';
import { AgentSettings } from './pages/AgentSettings';
import { TokenSettings } from './pages/TokenSettings';
import { Dashboard } from './pages/Dashboard';
import { Integrations } from './pages/Integrations';
import { Login } from './pages/Login';
import { Onboarding } from './pages/Onboarding';

export default function App() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/onboarding" element={<Onboarding />} />
      <Route path="/auth/callback" element={<OAuthCallbackPage />} />

      {/* Protected routes */}
      <Route element={<ProtectedRoute />}>
        <Route element={<DashboardLayout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/integrations" element={<Integrations />} />
          {/* /settings/integrations is the canonical URL per spec */}
          <Route path="/settings/integrations" element={<Integrations />} />
          {/* Agent login registry */}
          <Route path="/settings/agents" element={<AgentSettings />} />
          {/* Personal access tokens (FUL-93) */}
          <Route path="/settings/tokens" element={<TokenSettings />} />
          <Route path="/settings" element={<Navigate to="/settings/integrations" replace />} />
        </Route>
      </Route>

      {/* Root redirect */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />

      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

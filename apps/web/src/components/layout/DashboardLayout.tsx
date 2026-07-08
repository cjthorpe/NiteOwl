// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

import { ErrorBoundary } from '../ui/ErrorBoundary';

import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import './layout.css';

export function DashboardLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  // Close the mobile sidebar on route change. Adjusting state during render off a
  // previous-value tracker avoids a setState-in-effect cascade:
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [prevPathname, setPrevPathname] = useState(location.pathname);
  if (location.pathname !== prevPathname) {
    setPrevPathname(location.pathname);
    setSidebarOpen(false);
  }

  return (
    <div className="layout-shell">
      <Sidebar id="sidebar-nav" onNavigate={() => setSidebarOpen(false)} />

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="layout-sidebar-overlay"
          aria-hidden="true"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Mobile sidebar drawer */}
      <div
        className={`layout-sidebar-mobile${sidebarOpen ? ' is-open' : ''}`}
        aria-hidden={!sidebarOpen}
      >
        <Sidebar id="sidebar-mobile-nav" onNavigate={() => setSidebarOpen(false)} />
      </div>

      <div className="layout-main">
        <TopBar onMenuToggle={() => setSidebarOpen((prev) => !prev)} menuOpen={sidebarOpen} />

        <main className="layout-content" id="main-content">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

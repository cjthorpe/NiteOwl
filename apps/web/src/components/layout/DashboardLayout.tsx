import { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import './layout.css';

export function DashboardLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  // Close mobile sidebar on route change
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  return (
    <div className="layout-shell">
      <Sidebar
        id="sidebar-nav"
        onNavigate={() => setSidebarOpen(false)}
      />

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
        <Sidebar
          id="sidebar-mobile-nav"
          onNavigate={() => setSidebarOpen(false)}
        />
      </div>

      <div className="layout-main">
        <TopBar
          onMenuToggle={() => setSidebarOpen((prev) => !prev)}
          menuOpen={sidebarOpen}
        />

        <main className="layout-content" id="main-content">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

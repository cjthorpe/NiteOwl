import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import './layout.css';

export function DashboardLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="layout-shell">
      <Sidebar />

      <div className="layout-main">
        {/* Mobile top bar */}
        <header className="layout-topbar">
          <button
            type="button"
            aria-label={sidebarOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen((prev) => !prev)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-text)',
              cursor: 'pointer',
              padding: 'var(--space-2)',
              marginRight: 'var(--space-3)',
            }}
          >
            ☰
          </button>
          <span
            style={{
              fontSize: 'var(--text-lg)',
              fontWeight: 700,
              letterSpacing: '-0.03em',
            }}
          >
            Nite<span style={{ color: 'var(--color-accent)' }}>Owl</span>
          </span>
        </header>

        <main className="layout-content" id="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

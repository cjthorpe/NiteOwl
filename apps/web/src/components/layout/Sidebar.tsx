// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import type { JSX } from 'react';
import { NavLink } from 'react-router-dom';

interface NavItem {
  to: string;
  label: string;
  icon: () => JSX.Element;
}

function IconDashboard() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="1" y="1" width="6" height="6" rx="1" />
      <rect x="9" y="1" width="6" height="6" rx="1" />
      <rect x="1" y="9" width="6" height="6" rx="1" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
    </svg>
  );
}

function IconIntegrations() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="4" cy="8" r="2.5" />
      <circle cx="12" cy="4" r="2.5" />
      <circle cx="12" cy="12" r="2.5" />
      <line x1="6.5" y1="7" x2="9.5" y2="5" />
      <line x1="6.5" y1="9" x2="9.5" y2="11" />
    </svg>
  );
}

function IconAgents() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="5" r="3" />
      <path d="M2 14c0-3.314 2.686-6 6-6s6 2.686 6 6" />
      <path d="M11 5h1.5M12 4v2" />
    </svg>
  );
}

function IconKey() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="5" cy="11" r="3" />
      <path d="M7.1 8.9 14 2" />
      <path d="M11 5l2 2M9 7l1.5 1.5" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M2.93 2.93l1.06 1.06M12.01 12.01l1.06 1.06M2.93 13.07l1.06-1.06M12.01 3.99l1.06-1.06" />
    </svg>
  );
}

const navItems: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: IconDashboard },
  { to: '/settings/integrations', label: 'Integrations', icon: IconIntegrations },
  { to: '/settings/agents', label: 'AI Agents', icon: IconAgents },
  { to: '/settings/tokens', label: 'Access Tokens', icon: IconKey },
  { to: '/settings', label: 'Settings', icon: IconSettings },
];

interface SidebarProps {
  id?: string;
  onNavigate?: () => void;
}

export function Sidebar({ id, onNavigate }: SidebarProps) {
  return (
    <aside id={id} className="layout-sidebar" aria-label="Main navigation">
      <div className="sidebar-header">
        <span className="sidebar-logo">
          Nite<span>Owl</span>
        </span>
      </div>

      <nav className="sidebar-nav" aria-label="Primary">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              className={({ isActive }) => `sidebar-nav-item${isActive ? ' is-active' : ''}`}
            >
              <span className="sidebar-nav-item-icon">
                <Icon />
              </span>
              {item.label}
            </NavLink>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <span
          className="font-mono-id"
          style={{ color: 'var(--color-text-subtle)', fontSize: 'var(--text-xs)' }}
        >
          v0.1.0
        </span>
      </div>
    </aside>
  );
}

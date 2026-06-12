import { NavLink } from 'react-router-dom';

interface NavItem {
  to: string;
  label: string;
  icon: string;
}

const navItems: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: '▦' },
];

export function Sidebar() {
  return (
    <aside className="layout-sidebar" aria-label="Main navigation">
      <div className="sidebar-header">
        <span className="sidebar-logo">
          Nite<span>Owl</span>
        </span>
      </div>

      <nav className="sidebar-nav" aria-label="Primary">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `sidebar-nav-item${isActive ? ' is-active' : ''}`
            }
          >
            <span className="sidebar-nav-item-icon" aria-hidden="true">
              {item.icon}
            </span>
            {item.label}
          </NavLink>
        ))}
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

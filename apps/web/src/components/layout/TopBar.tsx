// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
interface TopBarProps {
  onMenuToggle: () => void;
  menuOpen: boolean;
}

export function TopBar({ onMenuToggle, menuOpen }: TopBarProps) {
  return (
    <header className="layout-topbar" aria-label="Mobile navigation bar">
      <button
        type="button"
        aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
        aria-expanded={menuOpen}
        aria-controls="sidebar-nav"
        onClick={onMenuToggle}
        className="topbar-menu-btn"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 18 18"
          fill="none"
          aria-hidden="true"
          strokeLinecap="round"
          strokeLinejoin="round"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          {menuOpen ? (
            <>
              <line x1="3" y1="3" x2="15" y2="15" />
              <line x1="15" y1="3" x2="3" y2="15" />
            </>
          ) : (
            <>
              <line x1="2" y1="4.5" x2="16" y2="4.5" />
              <line x1="2" y1="9" x2="16" y2="9" />
              <line x1="2" y1="13.5" x2="16" y2="13.5" />
            </>
          )}
        </svg>
      </button>

      <span className="topbar-logo">
        Nite<span>Owl</span>
      </span>
    </header>
  );
}

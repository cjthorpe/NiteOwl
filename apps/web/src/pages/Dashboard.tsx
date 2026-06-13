import { useState } from 'react';
import { ActivityFeed } from '../components/activity-feed/ActivityFeed';
import { MorningBriefing } from '../components/morning-briefing/MorningBriefing';
import '../components/morning-briefing/morning-briefing.css';

type DashboardMode = 'feed' | 'briefing';

const STORAGE_KEY = 'niteowl:dashboard-mode';

function readStoredMode(): DashboardMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'feed' || stored === 'briefing') return stored;
  } catch {
    // localStorage may be unavailable (private browsing, storage blocked)
  }
  return 'feed';
}

function persistMode(mode: DashboardMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}

export function Dashboard() {
  const [mode, setMode] = useState<DashboardMode>(readStoredMode);

  function handleModeChange(next: DashboardMode) {
    setMode(next);
    persistMode(next);
  }

  return (
    <section aria-labelledby="dashboard-heading">
      <h1
        id="dashboard-heading"
        style={{
          fontSize: 'var(--text-2xl)',
          fontWeight: 700,
          letterSpacing: '-0.03em',
          color: 'var(--color-text)',
          marginBottom: 'var(--space-6)',
        }}
      >
        Dashboard
      </h1>

      <div
        className="dashboard-mode-toggle"
        role="group"
        aria-label="Dashboard view mode"
      >
        <button
          type="button"
          className="mode-toggle-btn"
          aria-pressed={mode === 'feed'}
          onClick={() => handleModeChange('feed')}
        >
          Feed
        </button>
        <button
          type="button"
          className="mode-toggle-btn"
          aria-pressed={mode === 'briefing'}
          onClick={() => handleModeChange('briefing')}
        >
          Morning Briefing
        </button>
      </div>

      {mode === 'feed' ? <ActivityFeed /> : <MorningBriefing />}
    </section>
  );
}

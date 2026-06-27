// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import type { ActivityProvider } from '@niteowl/types';
import { useId, useRef } from 'react';

import type { TimeHours } from '../../hooks/useFeedFilters';

const TIME_OPTIONS: TimeHours[] = [8, 12, 24];

const PROVIDER_OPTIONS: { value: ActivityProvider; label: string }[] = [
  { value: 'github', label: 'GitHub' },
  { value: 'linear', label: 'Linear' },
  { value: 'jira', label: 'Jira' },
];

interface FeedFilterBarProps {
  hours: TimeHours;
  providers: ActivityProvider[];
  repo: string;
  onHoursChange: (h: TimeHours) => void;
  onProviderToggle: (p: ActivityProvider) => void;
  onRepoChange: (r: string) => void;
}

export function FeedFilterBar({
  hours,
  providers,
  repo,
  onHoursChange,
  onProviderToggle,
  onRepoChange,
}: FeedFilterBarProps) {
  const repoInputRef = useRef<HTMLInputElement>(null);
  const timeGroupId = useId();
  const repoId = useId();

  function handleRepoKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      onRepoChange('');
      repoInputRef.current?.blur();
    }
  }

  return (
    <div className="filter-bar" role="search" aria-label="Activity feed filters">
      {/* Time range */}
      <div className="filter-group" role="group" aria-labelledby={`${timeGroupId}-label`}>
        <span id={`${timeGroupId}-label`} className="filter-label">
          Window
        </span>
        {TIME_OPTIONS.map((h) => (
          <button
            key={h}
            type="button"
            className={`filter-time-btn${hours === h ? ' is-active' : ''}`}
            aria-pressed={hours === h}
            onClick={() => onHoursChange(h)}
          >
            {h}h
          </button>
        ))}
      </div>

      <div className="filter-divider" aria-hidden="true" />

      {/* Provider multi-select */}
      <div className="filter-group" role="group" aria-label="Filter by provider">
        <span className="filter-label" aria-hidden="true">
          Source
        </span>
        {PROVIDER_OPTIONS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            className={`filter-provider-btn${providers.includes(value) ? ' is-active' : ''}`}
            data-provider={value}
            aria-pressed={providers.includes(value)}
            onClick={() => onProviderToggle(value)}
          >
            <span className="sr-only">
              {providers.includes(value) ? `Remove ${label} filter` : `Add ${label} filter`}
            </span>
            <span aria-hidden="true">{label}</span>
          </button>
        ))}
      </div>

      <div className="filter-divider" aria-hidden="true" />

      {/* Repo text filter */}
      <div className="filter-group">
        <label htmlFor={repoId} className="filter-label">
          Repo
        </label>
        <input
          ref={repoInputRef}
          id={repoId}
          type="search"
          className="filter-repo-input"
          placeholder="Filter by repo…"
          value={repo}
          onChange={(e) => onRepoChange(e.target.value)}
          onKeyDown={handleRepoKeyDown}
          aria-label="Filter by repository name"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
    </div>
  );
}

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
/**
 * RepoAllowlistControl — view & edit the GitHub repo allowlist (FUL-83).
 *
 * Wraps `useRepoAllowlist` to render the GitHub integration's allowlist as a set
 * of removable chips with an add-input, plus a save flow. An empty allowlist is
 * surfaced prominently as "account-wide aggregation" so users understand that
 * removing every entry restores the default behaviour (ingest all repos).
 *
 * Renders nothing when the provider has no persisted integration (not connected).
 */

import { useEffect, useMemo, useState } from 'react';
import type { ActivityProvider } from '@niteowl/types';
import { useRepoAllowlist } from '../../hooks/useRepoAllowlist';
import {
  allowlistsEqual,
  isValidEntry,
  isWildcardEntry,
  normalizeAllowlist,
  normalizeEntry,
  splitInput,
} from '../../lib/repo-allowlist';

interface RepoAllowlistControlProps {
  /** Provider whose allowlist to manage. Defaults to GitHub. */
  provider?: ActivityProvider;
}

const PANEL_STYLE: React.CSSProperties = {
  background: 'var(--color-surface-raised)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
  padding: 'var(--space-6)',
};

export function RepoAllowlistControl({ provider = 'github' }: RepoAllowlistControlProps) {
  const { integration, isLoading, error, save } = useRepoAllowlist(provider);

  // Working copy of the allowlist; reset whenever the server value changes.
  const [entries, setEntries] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const serverAllowlist = integration?.repoAllowlist ?? [];

  useEffect(() => {
    setEntries(normalizeAllowlist(serverAllowlist));
    // serverAllowlist identity changes only when the hook updates the record.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [integration?.id, serverAllowlist.join(' ')]);

  const dirty = useMemo(
    () => !allowlistsEqual(entries, serverAllowlist),
    [entries, serverAllowlist],
  );
  const isAllowAll = entries.length === 0;

  // ── Don't render the control when there is nothing to configure ──────────
  if (isLoading) {
    return (
      <div
        aria-busy="true"
        aria-label="Loading repository allowlist…"
        style={{ ...PANEL_STYLE, height: 96, animation: 'pulse 1.5s ease-in-out infinite' }}
      />
    );
  }
  if (error) {
    return (
      <div
        role="alert"
        style={{
          ...PANEL_STYLE,
          color: 'var(--color-danger)',
          fontSize: 'var(--text-sm)',
          background: 'oklch(62% 0.23 25 / 0.08)',
          borderColor: 'oklch(62% 0.23 25 / 0.3)',
        }}
      >
        Couldn’t load the repository allowlist: {error}
      </div>
    );
  }
  if (!integration) return null;

  // ── Entry mutation ────────────────────────────────────────────────────────
  function addFromInput(raw: string) {
    const candidates = splitInput(raw);
    if (candidates.length === 0) return;

    const next = [...entries];
    const added = new Set(next);
    const invalid: string[] = [];

    for (const candidate of candidates) {
      const normalized = normalizeEntry(candidate);
      if (!isValidEntry(normalized)) {
        invalid.push(candidate);
        continue;
      }
      if (!added.has(normalized)) {
        added.add(normalized);
        next.push(normalized);
      }
    }

    if (invalid.length > 0) {
      setInputError(
        `Use owner/repo or owner/* — couldn’t parse: ${invalid.slice(0, 3).join(', ')}`,
      );
      return;
    }

    setInputError(null);
    setSaveError(null);
    setJustSaved(false);
    setEntries(next);
    setInputValue('');
  }

  function removeEntry(entry: string) {
    setJustSaved(false);
    setSaveError(null);
    setEntries((prev) => prev.filter((e) => e !== entry));
  }

  function resetToServer() {
    setEntries(normalizeAllowlist(serverAllowlist));
    setInputValue('');
    setInputError(null);
    setSaveError(null);
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const normalized = await save(entries);
      setEntries(normalizeAllowlist(normalized));
      setJustSaved(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save allowlist');
    } finally {
      setSaving(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <section style={PANEL_STYLE} aria-labelledby="allowlist-heading">
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-2)',
        }}
      >
        <h3
          id="allowlist-heading"
          style={{
            fontSize: 'var(--text-base)',
            fontWeight: 600,
            color: 'var(--color-text)',
            margin: 0,
            letterSpacing: '-0.01em',
          }}
        >
          Repository allowlist
        </h3>
        <ModePill isAllowAll={isAllowAll} count={entries.length} />
      </div>

      <p
        style={{
          fontSize: 'var(--text-sm)',
          color: 'var(--color-text-muted)',
          margin: '0 0 var(--space-4)',
          maxWidth: '60ch',
          lineHeight: 1.5,
        }}
      >
        Choose which repositories NiteOwl ingests for GitHub. Add{' '}
        <code style={codeStyle}>owner/repo</code> for a single repo or{' '}
        <code style={codeStyle}>owner/*</code> for every repo under an owner.
      </p>

      {/* Default-state callout — make "empty = all repos" unmistakable */}
      {isAllowAll ? (
        <div
          aria-live="polite"
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 'var(--space-3)',
            padding: 'var(--space-3) var(--space-4)',
            marginBottom: 'var(--space-4)',
            background: 'oklch(68% 0.22 278 / 0.08)',
            border: '1px solid oklch(68% 0.22 278 / 0.25)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <GlobeGlyph />
          <div>
            <p
              style={{
                margin: 0,
                fontSize: 'var(--text-sm)',
                fontWeight: 600,
                color: 'var(--color-text)',
              }}
            >
              Aggregating all repositories
            </p>
            <p
              style={{
                margin: '2px 0 0',
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-muted)',
              }}
            >
              No allowlist set — every repository on the account is ingested. Add an entry below to
              narrow this down.
            </p>
          </div>
        </div>
      ) : (
        <ul
          aria-label="Allowed repositories"
          style={{
            listStyle: 'none',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 'var(--space-2)',
            margin: '0 0 var(--space-4)',
            padding: 0,
          }}
        >
          {entries.map((entry) => (
            <li key={entry}>
              <RepoChip entry={entry} onRemove={() => removeEntry(entry)} />
            </li>
          ))}
        </ul>
      )}

      {/* Add input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          addFromInput(inputValue);
        }}
        style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start' }}
      >
        <div style={{ flex: 1 }}>
          <label htmlFor="allowlist-input" style={srOnly}>
            Add a repository to the allowlist
          </label>
          <input
            id="allowlist-input"
            type="text"
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              if (inputError) setInputError(null);
            }}
            placeholder="owner/repo or owner/*"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={inputError ? true : undefined}
            aria-describedby={inputError ? 'allowlist-input-error' : undefined}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              background: 'var(--color-surface)',
              border: `1px solid ${inputError ? 'var(--color-danger)' : 'var(--color-border)'}`,
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-text)',
              fontSize: 'var(--text-sm)',
              fontFamily: 'ui-monospace, monospace',
              outline: 'none',
              padding: 'var(--space-2) var(--space-3)',
              transition: 'border-color var(--duration-fast)',
            }}
            onFocus={(e) => {
              if (!inputError) e.currentTarget.style.borderColor = 'var(--color-border-focus)';
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = inputError
                ? 'var(--color-danger)'
                : 'var(--color-border)';
            }}
          />
        </div>
        <button
          type="submit"
          disabled={!inputValue.trim()}
          style={secondaryButton(!inputValue.trim())}
        >
          Add
        </button>
      </form>
      {inputError && (
        <p id="allowlist-input-error" role="alert" style={errorTextStyle}>
          {inputError}
        </p>
      )}

      {/* Save row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          marginTop: 'var(--space-5)',
          paddingTop: 'var(--space-4)',
          borderTop: '1px solid var(--color-border)',
        }}
      >
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!dirty || saving}
          style={primaryButton(!dirty || saving)}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        {dirty && !saving && (
          <button type="button" onClick={resetToServer} style={ghostButton}>
            Discard
          </button>
        )}
        <span
          aria-live="polite"
          style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}
        >
          {saveError ? (
            <span role="alert" style={{ color: 'var(--color-danger)' }}>
              {saveError}
            </span>
          ) : justSaved && !dirty ? (
            <span style={{ color: 'var(--color-success)' }}>Saved</span>
          ) : dirty ? (
            isAllowAll ? (
              'Saving with no entries restores account-wide aggregation.'
            ) : (
              'Unsaved changes'
            )
          ) : null}
        </span>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ModePill({ isAllowAll, count }: { isAllowAll: boolean; count: number }) {
  const accent = isAllowAll
    ? {
        fg: 'var(--color-text-muted)',
        bg: 'var(--color-surface-overlay)',
        bd: 'var(--color-border)',
      }
    : {
        fg: 'var(--color-accent)',
        bg: 'oklch(68% 0.22 278 / 0.1)',
        bd: 'oklch(68% 0.22 278 / 0.25)',
      };
  return (
    <span
      style={{
        flexShrink: 0,
        fontSize: 'var(--text-xs)',
        fontWeight: 500,
        color: accent.fg,
        background: accent.bg,
        border: `1px solid ${accent.bd}`,
        borderRadius: 'var(--radius-sm)',
        padding: '2px 8px',
        whiteSpace: 'nowrap',
      }}
    >
      {isAllowAll ? 'All repositories' : `${count} ${count === 1 ? 'repo' : 'repos'}`}
    </span>
  );
}

function RepoChip({ entry, onRemove }: { entry: string; onRemove: () => void }) {
  const wildcard = isWildcardEntry(entry);
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        padding: '4px 4px 4px 10px',
        background: wildcard ? 'oklch(68% 0.22 278 / 0.1)' : 'var(--color-surface-overlay)',
        border: `1px solid ${wildcard ? 'oklch(68% 0.22 278 / 0.3)' : 'var(--color-border)'}`,
        borderRadius: 'var(--radius-sm)',
        fontFamily: 'ui-monospace, monospace',
        fontSize: 'var(--text-xs)',
        color: wildcard ? 'var(--color-accent)' : 'var(--color-text)',
      }}
    >
      {entry}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${entry}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 18,
          height: 18,
          padding: 0,
          background: 'none',
          border: 'none',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--color-text-muted)',
          cursor: 'pointer',
          lineHeight: 1,
          transition: 'color var(--duration-fast), background var(--duration-fast)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--color-danger)';
          e.currentTarget.style.background = 'oklch(62% 0.23 25 / 0.12)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--color-text-muted)';
          e.currentTarget.style.background = 'none';
        }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path
            d="M1 1l8 8M9 1l-8 8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </span>
  );
}

function GlobeGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{ flexShrink: 0, marginTop: 1, color: 'var(--color-accent)' }}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const codeStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, monospace',
  fontSize: '0.85em',
  color: 'var(--color-text)',
  background: 'var(--color-surface-overlay)',
  padding: '1px 5px',
  borderRadius: 'var(--radius-sm)',
};

const errorTextStyle: React.CSSProperties = {
  color: 'var(--color-danger)',
  fontSize: 'var(--text-xs)',
  margin: 'var(--space-2) 0 0',
};

const srOnly: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

function primaryButton(disabled: boolean): React.CSSProperties {
  return {
    background: disabled ? 'oklch(68% 0.22 278 / 0.4)' : 'var(--color-accent)',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    color: 'oklch(12% 0.01 260)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: 'var(--text-sm)',
    fontWeight: 600,
    padding: 'var(--space-2) var(--space-4)',
    transition: 'opacity var(--duration-fast)',
  };
}

function secondaryButton(disabled: boolean): React.CSSProperties {
  return {
    alignSelf: 'flex-start',
    background: 'var(--color-surface-overlay)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    color: disabled ? 'var(--color-text-subtle)' : 'var(--color-text)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: 'var(--text-sm)',
    fontWeight: 500,
    padding: 'var(--space-2) var(--space-4)',
    whiteSpace: 'nowrap',
    transition: 'border-color var(--duration-fast), color var(--duration-fast)',
  };
}

const ghostButton: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--color-text-muted)',
  cursor: 'pointer',
  fontSize: 'var(--text-sm)',
  padding: 'var(--space-2) var(--space-2)',
};

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { usePersonalAccessTokens } from '../hooks/usePersonalAccessTokens';
import type { CreatedToken, PersonalAccessToken } from '../lib/tokens-api';
import {
  EXPIRY_OPTIONS,
  MAX_NAME_LENGTH,
  formatExpiry,
  formatLastUsed,
  validateTokenName,
  type ExpiryTone,
} from '../lib/tokens';

// ---------------------------------------------------------------------------
// Shared token-color lookup for expiry badges
// ---------------------------------------------------------------------------

const TONE_COLOR: Record<ExpiryTone, string> = {
  neutral: 'var(--color-text-muted)',
  warning: 'var(--color-warning)',
  danger: 'var(--color-danger)',
};

function formatCreated(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// CreateTokenForm — name + expiry → mint
// ---------------------------------------------------------------------------

interface CreateTokenFormProps {
  onCreate: (name: string, expiresInDays: number | null) => Promise<void>;
}

function CreateTokenForm({ onCreate }: CreateTokenFormProps) {
  const [name, setName] = useState('');
  const [expiryIndex, setExpiryIndex] = useState(0);
  const [pending, setPending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const validationError = validateTokenName(name);
    if (validationError) {
      setLocalError(validationError);
      return;
    }

    setPending(true);
    setLocalError(null);
    try {
      await onCreate(name.trim(), EXPIRY_OPTIONS[expiryIndex]!.days);
      setName('');
      setExpiryIndex(0);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to create token');
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      style={{
        background: 'var(--color-surface-raised)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-6)',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 'var(--space-3)',
        alignItems: 'flex-end',
      }}
    >
      <div style={{ flex: '1 1 220px', minWidth: 0 }}>
        <label
          htmlFor="pat-name"
          style={{
            display: 'block',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
            marginBottom: 'var(--space-1)',
          }}
        >
          Token name
        </label>
        <input
          id="pat-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. CI pipeline, laptop CLI"
          disabled={pending}
          maxLength={MAX_NAME_LENGTH}
          autoComplete="off"
          spellCheck={false}
          aria-describedby={localError ? 'pat-name-error' : undefined}
          style={{
            width: '100%',
            background: 'var(--color-surface)',
            border: `1px solid ${localError ? 'var(--color-danger)' : 'var(--color-border)'}`,
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-text)',
            fontSize: 'var(--text-sm)',
            outline: 'none',
            padding: 'var(--space-2) var(--space-3)',
            transition: 'border-color var(--duration-fast)',
            boxSizing: 'border-box',
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = 'var(--color-border-focus)';
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = localError
              ? 'var(--color-danger)'
              : 'var(--color-border)';
          }}
        />
      </div>

      <div style={{ flex: '0 0 auto' }}>
        <label
          htmlFor="pat-expiry"
          style={{
            display: 'block',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
            marginBottom: 'var(--space-1)',
          }}
        >
          Expiry
        </label>
        <select
          id="pat-expiry"
          value={expiryIndex}
          onChange={(e) => setExpiryIndex(Number(e.target.value))}
          disabled={pending}
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-text)',
            fontSize: 'var(--text-sm)',
            outline: 'none',
            padding: 'var(--space-2) var(--space-3)',
            cursor: pending ? 'not-allowed' : 'pointer',
          }}
        >
          {EXPIRY_OPTIONS.map((opt, i) => (
            <option key={opt.label} value={i}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <button
        type="submit"
        disabled={pending || name.trim().length === 0}
        style={{
          flex: '0 0 auto',
          background: pending ? 'oklch(68% 0.22 278 / 0.5)' : 'var(--color-accent)',
          border: 'none',
          borderRadius: 'var(--radius-md)',
          color: 'oklch(98% 0 0)',
          cursor: pending || name.trim().length === 0 ? 'not-allowed' : 'pointer',
          fontSize: 'var(--text-sm)',
          fontWeight: 600,
          padding: 'var(--space-2) var(--space-5)',
          transition: 'background var(--duration-fast)',
          whiteSpace: 'nowrap',
        }}
      >
        {pending ? 'Generating…' : 'Generate token'}
      </button>

      {localError && (
        <p
          id="pat-name-error"
          role="alert"
          style={{
            flexBasis: '100%',
            color: 'var(--color-danger)',
            fontSize: 'var(--text-xs)',
            margin: 0,
          }}
        >
          {localError}
        </p>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
// RevealPanel — shows the freshly minted token exactly once
// ---------------------------------------------------------------------------

interface RevealPanelProps {
  token: CreatedToken;
  onDismiss: () => void;
}

function RevealPanel({ token, onDismiss }: RevealPanelProps) {
  const [copied, setCopied] = useState(false);
  const copyRef = useRef<HTMLButtonElement>(null);

  // Pull focus to the panel so screen-reader users land on the one-time value.
  useEffect(() => {
    copyRef.current?.focus();
  }, []);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(token.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (insecure context / permission) — leave the value
      // visible so the user can select and copy it manually.
      setCopied(false);
    }
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        background: 'var(--color-surface-raised)',
        border: '1px solid var(--color-success)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-6)',
        boxShadow: 'var(--shadow-md)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-2)',
        }}
      >
        <h2
          style={{
            fontSize: 'var(--text-base)',
            fontWeight: 600,
            color: 'var(--color-text)',
            margin: 0,
          }}
        >
          Token “{token.name}” created
        </h2>
        <button
          type="button"
          onClick={onDismiss}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--color-text-muted)',
            cursor: 'pointer',
            fontSize: 'var(--text-xs)',
            padding: 'var(--space-1)',
          }}
        >
          Done
        </button>
      </div>

      <p
        style={{
          margin: '0 0 var(--space-4)',
          fontSize: 'var(--text-sm)',
          color: 'var(--color-warning)',
        }}
      >
        Copy it now — for your security, this is the only time it will be shown.
      </p>

      <div
        style={{
          display: 'flex',
          gap: 'var(--space-2)',
          alignItems: 'stretch',
          flexWrap: 'wrap',
        }}
      >
        <code
          style={{
            flex: '1 1 280px',
            minWidth: 0,
            overflowX: 'auto',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-text)',
            fontFamily: 'ui-monospace, monospace',
            fontSize: 'var(--text-sm)',
            padding: 'var(--space-3)',
            whiteSpace: 'nowrap',
          }}
        >
          {token.token}
        </code>
        <button
          ref={copyRef}
          type="button"
          onClick={() => void handleCopy()}
          aria-label="Copy token to clipboard"
          style={{
            flex: '0 0 auto',
            background: copied ? 'var(--color-success)' : 'var(--color-accent)',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            color: 'oklch(98% 0 0)',
            cursor: 'pointer',
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            padding: 'var(--space-2) var(--space-4)',
            transition: 'background var(--duration-fast)',
            whiteSpace: 'nowrap',
          }}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TokenRow — one token with metadata and an inline two-step revoke
// ---------------------------------------------------------------------------

interface TokenRowProps {
  token: PersonalAccessToken;
  onRevoke: (id: string) => Promise<void>;
}

function TokenRow({ token, onRevoke }: TokenRowProps) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  const expiry = formatExpiry(token.expiresAt);

  async function handleRevoke() {
    setPending(true);
    setRowError(null);
    try {
      await onRevoke(token.id);
      // Row unmounts on success; no further state update needed.
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Failed to revoke');
      setPending(false);
      setConfirming(false);
    }
  }

  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-4)',
        padding: 'var(--space-4)',
        background: 'var(--color-surface-overlay)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            color: 'var(--color-text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {token.name}
        </div>
        <div
          style={{
            marginTop: 'var(--space-1)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 'var(--space-3)',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
          }}
        >
          <span>Created {formatCreated(token.createdAt)}</span>
          <span>{formatLastUsed(token.lastUsedAt)}</span>
          <span style={{ color: TONE_COLOR[expiry.tone] }}>{expiry.label}</span>
        </div>
        {rowError && (
          <p
            role="alert"
            style={{
              margin: 'var(--space-1) 0 0',
              fontSize: 'var(--text-xs)',
              color: 'var(--color-danger)',
            }}
          >
            {rowError}
          </p>
        )}
      </div>

      {confirming ? (
        <div style={{ display: 'flex', gap: 'var(--space-2)', flex: '0 0 auto' }}>
          <button
            type="button"
            onClick={() => void handleRevoke()}
            disabled={pending}
            style={{
              background: 'var(--color-danger)',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              color: 'oklch(98% 0 0)',
              cursor: pending ? 'not-allowed' : 'pointer',
              fontSize: 'var(--text-xs)',
              fontWeight: 600,
              padding: 'var(--space-1) var(--space-3)',
            }}
          >
            {pending ? 'Revoking…' : 'Confirm revoke'}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={pending}
            style={{
              background: 'none',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              fontSize: 'var(--text-xs)',
              padding: 'var(--space-1) var(--space-3)',
            }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          aria-label={`Revoke ${token.name}`}
          style={{
            flex: '0 0 auto',
            background: 'none',
            border: '1px solid transparent',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-text-muted)',
            cursor: 'pointer',
            fontSize: 'var(--text-xs)',
            padding: 'var(--space-1) var(--space-3)',
            transition: 'color var(--duration-fast), border-color var(--duration-fast)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--color-danger)';
            e.currentTarget.style.borderColor = 'var(--color-danger)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--color-text-muted)';
            e.currentTarget.style.borderColor = 'transparent';
          }}
        >
          Revoke
        </button>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// TokenSettings page
// ---------------------------------------------------------------------------

export function TokenSettings() {
  const { tokens, isLoading, error, create, revoke } = usePersonalAccessTokens();
  const [revealed, setRevealed] = useState<CreatedToken | null>(null);

  async function handleCreate(name: string, expiresInDays: number | null) {
    const created = await create(expiresInDays === null ? { name } : { name, expiresInDays });
    setRevealed(created);
  }

  return (
    <section aria-labelledby="tokens-heading">
      <header style={{ marginBottom: 'var(--space-8)' }}>
        <h1
          id="tokens-heading"
          style={{
            fontSize: 'var(--text-2xl)',
            fontWeight: 700,
            letterSpacing: '-0.03em',
            color: 'var(--color-text)',
            margin: 0,
          }}
        >
          Personal Access Tokens
        </h1>
        <p
          style={{
            marginTop: 'var(--space-2)',
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text-muted)',
            maxWidth: '56ch',
          }}
        >
          Use a personal access token to authenticate to the NiteOwl API from scripts and the CLI.
          Tokens carry your full account access — treat them like a password.
        </p>
      </header>

      {error && (
        <div
          role="alert"
          style={{
            marginBottom: 'var(--space-6)',
            padding: 'var(--space-4)',
            background: 'oklch(62% 0.23 25 / 0.08)',
            border: '1px solid oklch(62% 0.23 25 / 0.3)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-danger)',
            fontSize: 'var(--text-sm)',
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
        {revealed ? (
          <RevealPanel token={revealed} onDismiss={() => setRevealed(null)} />
        ) : (
          <CreateTokenForm onCreate={handleCreate} />
        )}

        {isLoading ? (
          <div
            aria-busy="true"
            aria-label="Loading tokens…"
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}
          >
            {[0, 1].map((i) => (
              <div
                key={i}
                style={{
                  height: 72,
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--color-surface-raised)',
                  border: '1px solid var(--color-border)',
                  animation: 'pulse 1.5s ease-in-out infinite',
                  opacity: 1 - i * 0.2,
                }}
              />
            ))}
          </div>
        ) : tokens.length === 0 ? (
          <div
            style={{
              padding: 'var(--space-8)',
              textAlign: 'center',
              background: 'var(--color-surface-raised)',
              border: '1px dashed var(--color-border)',
              borderRadius: 'var(--radius-lg)',
              color: 'var(--color-text-muted)',
              fontSize: 'var(--text-sm)',
            }}
          >
            No personal access tokens yet. Generate one above to start using the API.
          </div>
        ) : (
          <ul
            aria-label="Your personal access tokens"
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-2)',
            }}
          >
            {tokens.map((token) => (
              <TokenRow key={token.id} token={token} onRevoke={revoke} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

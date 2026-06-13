import { useState, type FormEvent } from 'react';
import { useAgentLogins, type AgentIntegration } from '../hooks/useAgentLogins';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INTEGRATIONS: { key: AgentIntegration; label: string; placeholder: string }[] = [
  { key: 'github', label: 'GitHub', placeholder: 'e.g. my-bot[bot] or dependabot' },
  { key: 'linear', label: 'Linear', placeholder: 'e.g. agent-username' },
  { key: 'jira', label: 'Jira', placeholder: 'e.g. jira-agent' },
];

// ---------------------------------------------------------------------------
// IntegrationSection — one card per integration
// ---------------------------------------------------------------------------

interface IntegrationSectionProps {
  integration: AgentIntegration;
  label: string;
  placeholder: string;
  logins: { id: string; login: string }[];
  onAdd: (login: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}

function IntegrationSection({
  integration,
  label,
  placeholder,
  logins,
  onAdd,
  onRemove,
}: IntegrationSectionProps) {
  const [inputValue, setInputValue] = useState('');
  const [pending, setPending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = inputValue.trim();
    if (!trimmed) return;

    setPending(true);
    setLocalError(null);

    try {
      await onAdd(trimmed);
      setInputValue('');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to add login');
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      style={{
        background: 'var(--color-surface-raised)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-6)',
      }}
    >
      {/* Integration header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-4)',
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
          {label}
        </h2>
        {logins.length > 0 && (
          <span
            style={{
              fontSize: 'var(--text-xs)',
              fontWeight: 500,
              color: 'var(--color-accent)',
              background: 'oklch(68% 0.22 278 / 0.1)',
              border: '1px solid oklch(68% 0.22 278 / 0.2)',
              borderRadius: 'var(--radius-sm)',
              padding: '2px 8px',
            }}
          >
            {logins.length} registered
          </span>
        )}
      </div>

      {/* Registered logins list */}
      {logins.length > 0 && (
        <ul
          style={{
            listStyle: 'none',
            margin: '0 0 var(--space-4)',
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
          }}
          aria-label={`Registered ${label} agent logins`}
        >
          {logins.map((entry) => (
            <li
              key={entry.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: 'var(--space-2) var(--space-3)',
                background: 'var(--color-surface-overlay)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)',
              }}
            >
              <code
                style={{
                  fontSize: 'var(--text-sm)',
                  color: 'var(--color-text)',
                  fontFamily: 'ui-monospace, monospace',
                }}
              >
                {entry.login}
              </code>
              <button
                type="button"
                onClick={() => void onRemove(entry.id)}
                aria-label={`Remove ${entry.login} from ${label}`}
                style={{
                  background: 'none',
                  border: '1px solid transparent',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--color-text-muted)',
                  cursor: 'pointer',
                  fontSize: 'var(--text-xs)',
                  padding: '2px var(--space-2)',
                  transition: `color var(--duration-fast), border-color var(--duration-fast)`,
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-danger)';
                  (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--color-danger)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-muted)';
                  (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent';
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Add form */}
      <form
        onSubmit={(e) => void handleSubmit(e)}
        style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start' }}
      >
        <div style={{ flex: 1 }}>
          <label
            htmlFor={`add-${integration}`}
            style={{
              display: 'block',
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-muted)',
              marginBottom: 'var(--space-1)',
            }}
          >
            {placeholder}
          </label>
          <input
            id={`add-${integration}`}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={placeholder}
            disabled={pending}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={localError ? `${integration}-error` : undefined}
            style={{
              width: '100%',
              background: 'var(--color-surface)',
              border: `1px solid ${localError ? 'var(--color-danger)' : 'var(--color-border)'}`,
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-text)',
              fontSize: 'var(--text-sm)',
              outline: 'none',
              padding: `var(--space-2) var(--space-3)`,
              transition: 'border-color var(--duration-fast)',
              boxSizing: 'border-box',
            }}
            onFocus={(e) => {
              (e.currentTarget as HTMLInputElement).style.borderColor = 'var(--color-border-focus)';
            }}
            onBlur={(e) => {
              (e.currentTarget as HTMLInputElement).style.borderColor =
                localError ? 'var(--color-danger)' : 'var(--color-border)';
            }}
          />
          {localError && (
            <p
              id={`${integration}-error`}
              role="alert"
              style={{
                color: 'var(--color-danger)',
                fontSize: 'var(--text-xs)',
                marginTop: 'var(--space-1)',
              }}
            >
              {localError}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={pending || !inputValue.trim()}
          style={{
            alignSelf: 'flex-end',
            background: pending
              ? 'oklch(68% 0.22 278 / 0.5)'
              : 'oklch(68% 0.22 278)',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            color: 'oklch(98% 0 0)',
            cursor: pending ? 'not-allowed' : 'pointer',
            fontSize: 'var(--text-sm)',
            fontWeight: 500,
            padding: `var(--space-2) var(--space-4)`,
            transition: 'background var(--duration-fast)',
            whiteSpace: 'nowrap',
          }}
        >
          {pending ? 'Adding…' : 'Add'}
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AgentSettings page
// ---------------------------------------------------------------------------

export function AgentSettings() {
  const { isLoading, error, byIntegration, addLogin, removeLogin } = useAgentLogins();

  return (
    <section aria-labelledby="agents-heading">
      {/* Page header */}
      <header style={{ marginBottom: 'var(--space-8)' }}>
        <h1
          id="agents-heading"
          style={{
            fontSize: 'var(--text-2xl)',
            fontWeight: 700,
            letterSpacing: '-0.03em',
            color: 'var(--color-text)',
            margin: 0,
          }}
        >
          AI Agents
        </h1>
        <p
          style={{
            marginTop: 'var(--space-2)',
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text-muted)',
            maxWidth: '52ch',
          }}
        >
          Register the usernames your AI coding agents use on each integration. Registered
          logins auto-populate feed filters and Slack alert configurations.
        </p>
      </header>

      {/* Error state */}
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

      {/* Loading skeleton */}
      {isLoading ? (
        <div
          aria-busy="true"
          aria-label="Loading agent logins…"
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
        >
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                height: 120,
                borderRadius: 'var(--radius-lg)',
                background: 'var(--color-surface-raised)',
                border: '1px solid var(--color-border)',
                animation: 'pulse 1.5s ease-in-out infinite',
                opacity: 1 - i * 0.15,
              }}
            />
          ))}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {INTEGRATIONS.map(({ key, label, placeholder }) => (
            <IntegrationSection
              key={key}
              integration={key}
              label={label}
              placeholder={placeholder}
              logins={byIntegration(key)}
              onAdd={(login) => addLogin(key, login)}
              onRemove={removeLogin}
            />
          ))}
        </div>
      )}

      {/* Footer note */}
      <p
        className="mt-8 text-xs"
        style={{ color: 'var(--color-text-subtle)', marginTop: 'var(--space-8)' }}
      >
        Feed filter auto-population requires the author_login feed column (FUL-58).
      </p>
    </section>
  );
}

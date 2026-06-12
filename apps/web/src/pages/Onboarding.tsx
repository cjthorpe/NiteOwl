import { useNavigate } from 'react-router-dom';

export function Onboarding() {
  const navigate = useNavigate();

  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--color-surface)',
        padding: 'var(--space-8)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '560px',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-8)',
        }}
      >
        <header>
          <h1
            style={{
              fontSize: 'var(--text-3xl)',
              fontWeight: 800,
              letterSpacing: '-0.04em',
              color: 'var(--color-text)',
              margin: 0,
            }}
          >
            Set up your workspace
          </h1>
          <p
            style={{
              marginTop: 'var(--space-2)',
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text-muted)',
            }}
          >
            Connect your repositories and providers to get started.
          </p>
        </header>

        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          style={{
            alignSelf: 'flex-start',
            padding: 'var(--space-3) var(--space-6)',
            backgroundColor: 'var(--color-accent)',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            color: 'oklch(98% 0 0)',
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Continue to dashboard
        </button>
      </div>
    </main>
  );
}

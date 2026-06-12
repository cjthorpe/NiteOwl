import { useNavigate } from 'react-router-dom';

export function Login() {
  const navigate = useNavigate();

  function handleDevLogin() {
    localStorage.setItem('niteowl:auth', 'true');
    navigate('/dashboard');
  }

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
          maxWidth: '400px',
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
            Nite<span style={{ color: 'var(--color-accent)' }}>Owl</span>
          </h1>
          <p
            style={{
              marginTop: 'var(--space-2)',
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text-muted)',
            }}
          >
            Sign in to your workspace
          </p>
        </header>

        <div
          style={{
            backgroundColor: 'var(--color-surface-raised)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-lg)',
            padding: 'var(--space-8)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-4)',
          }}
        >
          {/* GitHub OAuth placeholder */}
          <button
            type="button"
            onClick={handleDevLogin}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 'var(--space-3)',
              padding: 'var(--space-3) var(--space-4)',
              backgroundColor: 'var(--color-surface-overlay)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-text)',
              fontSize: 'var(--text-sm)',
              fontWeight: 600,
              cursor: 'pointer',
              transition:
                'border-color var(--duration-fast) var(--ease-in-out), background-color var(--duration-fast) var(--ease-in-out)',
              width: '100%',
            }}
          >
            Continue with GitHub
          </button>
        </div>
      </div>
    </main>
  );
}

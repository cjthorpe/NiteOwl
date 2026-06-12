import { useNavigate } from 'react-router-dom';
import { IntegrationCard } from '../../components/integration-card/IntegrationCard';
import { ProgressStepper } from '../../components/ui/ProgressStepper';
import { useIntegrations } from '../../hooks/useIntegrations';
import { getIntegration, INTEGRATIONS, OPTIONAL_PROVIDERS, PRIMARY_PROVIDER } from '../../lib/integrations';
import { ProviderLogo } from '../../components/ui/ProviderLogo';
import { buildOAuthStartUrl } from '../../lib/integrations';

const STEPS = [
  { label: 'Connect GitHub' },
  { label: 'Add integration' },
  { label: 'Done' },
];

export function OnboardingPage() {
  const navigate = useNavigate();
  const { isConnected } = useIntegrations();

  const githubConnected = isConnected(PRIMARY_PROVIDER);
  const step = githubConnected ? 2 : 1;

  const handleGitHubConnect = () => {
    window.location.href = buildOAuthStartUrl(PRIMARY_PROVIDER, window.location.origin);
  };

  const handleFinish = () => {
    navigate('/dashboard');
  };

  return (
    <div className="flex min-h-dvh flex-col" style={{ backgroundColor: 'var(--color-surface)' }}>
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
          NiteOwl
        </span>
        <ProgressStepper steps={STEPS} current={step} />
      </header>

      {/* Main */}
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-16">
        <div className="w-full max-w-lg">

          {/* Step 1: Connect GitHub */}
          {step === 1 && <StepConnectGitHub onConnect={handleGitHubConnect} />}

          {/* Step 2: Optional integrations */}
          {step === 2 && (
            <StepOptionalIntegrations onContinue={handleFinish} />
          )}
        </div>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step 1                                                              */
/* ------------------------------------------------------------------ */

function StepConnectGitHub({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="flex flex-col items-center text-center">
      {/* Hero logo */}
      <div
        className="mb-8 flex h-20 w-20 items-center justify-center rounded-2xl"
        style={{
          backgroundColor: 'oklch(95% 0 0 / 0.08)',
          boxShadow: '0 0 0 1px oklch(95% 0 0 / 0.15), 0 12px 40px oklch(0% 0 0 / 0.4)',
        }}
      >
        <ProviderLogo provider="github" size={40} style={{ color: 'oklch(95% 0 0)' }} />
      </div>

      <h1
        className="mb-3 text-balance font-semibold leading-tight"
        style={{ fontSize: 'var(--text-3xl)', color: 'var(--color-text)' }}
      >
        Connect GitHub to get started
      </h1>
      <p
        className="mb-10 max-w-sm text-balance"
        style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-muted)', lineHeight: 1.7 }}
      >
        NiteOwl captures your pull requests, commits, and code reviews to give you a complete picture of your engineering output.
      </p>

      {/* Hero CTA */}
      <button
        type="button"
        onClick={onConnect}
        className="group flex items-center gap-3 rounded-xl px-8 py-4 font-semibold transition-all"
        style={{
          backgroundColor: 'oklch(95% 0 0)',
          color: 'oklch(12% 0.01 260)',
          fontSize: 'var(--text-base)',
          border: 'none',
          cursor: 'pointer',
          boxShadow: '0 4px 16px oklch(0% 0 0 / 0.3)',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-2px)';
          (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 8px 24px oklch(0% 0 0 / 0.4)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)';
          (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 16px oklch(0% 0 0 / 0.3)';
        }}
      >
        <ProviderLogo provider="github" size={20} />
        Connect GitHub
      </button>

      <p className="mt-6 text-xs" style={{ color: 'var(--color-text-subtle)' }}>
        You'll be redirected to GitHub to authorize. We never store your code.
      </p>

      {/* Trust indicators */}
      <div className="mt-12 flex flex-wrap justify-center gap-6">
        {(['Pull requests', 'Commits', 'Code reviews', 'Issues'] as const).map((cap) => (
          <div key={cap} className="flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M2.5 7l3 3 6-6" stroke="var(--color-success)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{cap}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step 2                                                              */
/* ------------------------------------------------------------------ */

function StepOptionalIntegrations({ onContinue }: { onContinue: () => void }) {
  const { isConnected } = useIntegrations();
  const githubMeta = getIntegration(PRIMARY_PROVIDER)!;
  const optionalMetas = OPTIONAL_PROVIDERS.map((p) => getIntegration(p)!);

  return (
    <div>
      <div className="mb-8 text-center">
        <h1
          className="mb-2 font-semibold"
          style={{ fontSize: 'var(--text-3xl)', color: 'var(--color-text)' }}
        >
          GitHub connected
        </h1>
        <p style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-muted)' }}>
          Add more integrations to enrich your feed, or continue to your dashboard.
        </p>
      </div>

      {/* GitHub — already connected */}
      <IntegrationCard meta={githubMeta} compact />

      {/* Divider */}
      <div className="my-5 flex items-center gap-3">
        <div className="flex-1 h-px" style={{ backgroundColor: 'var(--color-border)' }} />
        <span className="text-xs" style={{ color: 'var(--color-text-subtle)' }}>Optional</span>
        <div className="flex-1 h-px" style={{ backgroundColor: 'var(--color-border)' }} />
      </div>

      {/* Optional integrations */}
      <div className="flex flex-col gap-3">
        {optionalMetas.map((meta) => (
          <IntegrationCard key={meta.provider} meta={meta} compact />
        ))}
      </div>

      {/* Continue */}
      <div className="mt-8 flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={onContinue}
          className="w-full rounded-xl py-3.5 font-semibold transition-all"
          style={{
            backgroundColor: 'var(--color-accent)',
            color: 'oklch(12% 0.01 260)',
            fontSize: 'var(--text-base)',
            border: 'none',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.opacity = '0.88';
            (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.opacity = '1';
            (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)';
          }}
        >
          {OPTIONAL_PROVIDERS.some(isConnected)
            ? 'Continue to dashboard →'
            : 'Skip for now →'}
        </button>
        <p className="text-xs" style={{ color: 'var(--color-text-subtle)' }}>
          You can add integrations any time in Settings.
        </p>
      </div>
    </div>
  );
}

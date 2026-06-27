// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { ActivityProvider } from '@niteowl/types';
import { useIntegrations } from '../../hooks/useIntegrations';
import { ProviderLogo } from '../../components/ui/ProviderLogo';
import { getIntegration } from '../../lib/integrations';
import { refreshAccessToken } from '../../lib/auth';

type CallbackStatus = 'loading' | 'success' | 'error';

const VALID_PROVIDERS: ActivityProvider[] = ['github', 'linear', 'jira', 'slack'];

function isValidProvider(value: string | null): value is ActivityProvider {
  return VALID_PROVIDERS.includes(value as ActivityProvider);
}

export function OAuthCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { connect } = useIntegrations();

  const provider = searchParams.get('provider');
  const status = searchParams.get('status'); // 'success' | 'error'
  const errorCode = searchParams.get('error');
  const eventCountParam = searchParams.get('event_count');

  const [callbackStatus, setCallbackStatus] = useState<CallbackStatus>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Prevent double-processing in StrictMode
  const processed = useRef(false);

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;

    if (!isValidProvider(provider)) {
      setErrorMessage('Unknown integration provider.');
      setCallbackStatus('error');
      return;
    }

    if (status === 'error' || errorCode) {
      const msg = mapErrorCode(errorCode);
      setErrorMessage(msg);
      setCallbackStatus('error');
      return;
    }

    if (status === 'success') {
      const eventCount = Number(eventCountParam) || 0;

      // Exchange the HttpOnly refresh cookie (set by the API callback) for a
      // short-lived JWT access token.  This is required for all protected API
      // calls; without it every request gets a 401.
      refreshAccessToken().then((token) => {
        if (!token) {
          setErrorMessage('Session could not be established. Please try again.');
          setCallbackStatus('error');
          return;
        }

        connect(provider, eventCount);
        setCallbackStatus('success');
      });

      return;
    }

    // No recognisable params — treat as error
    setErrorMessage('The connection could not be completed. Please try again.');
    setCallbackStatus('error');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-navigate after showing the success state briefly
  useEffect(() => {
    if (callbackStatus !== 'success') return;
    const timer = setTimeout(() => {
      navigate('/onboarding', { replace: true });
    }, 1800);
    return () => clearTimeout(timer);
  }, [callbackStatus, navigate]);

  const meta = isValidProvider(provider) ? getIntegration(provider) : undefined;

  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center px-4"
      style={{ backgroundColor: 'var(--color-surface)' }}
    >
      <div className="w-full max-w-sm text-center">
        {callbackStatus === 'loading' && <LoadingState />}

        {callbackStatus === 'success' && meta && (
          <SuccessState
            provider={provider as ActivityProvider}
            providerName={meta.name}
            brandColor={meta.brandColor}
          />
        )}

        {callbackStatus === 'error' && (
          <ErrorState
            message={errorMessage ?? 'Something went wrong.'}
            {...(isValidProvider(provider) ? { provider } : {})}
            onRetry={() => navigate('/onboarding')}
          />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-states                                                          */
/* ------------------------------------------------------------------ */

function LoadingState() {
  return (
    <>
      <div
        className="mx-auto mb-6 h-14 w-14 rounded-full border-2 border-transparent"
        style={{
          borderTopColor: 'var(--color-accent)',
          animation: 'spin 0.7s linear infinite',
        }}
        aria-hidden
      />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-base)' }}>
        Completing connection…
      </p>
    </>
  );
}

function SuccessState({
  provider,
  providerName,
  brandColor,
}: {
  provider: ActivityProvider;
  providerName: string;
  brandColor: string;
}) {
  return (
    <>
      {/* Provider logo with success ring */}
      <div
        className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl"
        style={{
          backgroundColor: `${brandColor}12`,
          boxShadow: `0 0 0 2px ${brandColor}30, 0 8px 24px oklch(0% 0 0 / 0.4)`,
        }}
      >
        <ProviderLogo provider={provider} size={32} style={{ color: brandColor }} />
      </div>

      {/* Check */}
      <div
        className="mx-auto mb-6 flex h-10 w-10 items-center justify-center rounded-full"
        style={{ backgroundColor: 'oklch(68% 0.18 145 / 0.15)', color: 'var(--color-success)' }}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
          <path
            d="M3 9l4.5 4.5 7.5-9"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <h1
        className="mb-2 font-semibold"
        style={{ fontSize: 'var(--text-2xl)', color: 'var(--color-text)' }}
      >
        {providerName} connected
      </h1>
      <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
        Redirecting you back…
      </p>
    </>
  );
}

function ErrorState({
  message,
  provider,
  onRetry,
}: {
  message: string;
  provider?: ActivityProvider;
  onRetry: () => void;
}) {
  return (
    <>
      <div
        className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full"
        style={{ backgroundColor: 'oklch(62% 0.23 25 / 0.12)', color: 'var(--color-danger)' }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <h1
        className="mb-2 font-semibold"
        style={{ fontSize: 'var(--text-2xl)', color: 'var(--color-text)' }}
      >
        Connection failed
      </h1>
      <p className="mb-6 text-sm" style={{ color: 'var(--color-text-muted)' }}>
        {message}
      </p>

      <button
        type="button"
        onClick={onRetry}
        className="rounded-xl px-6 py-3 font-semibold transition-all"
        style={{
          backgroundColor: 'var(--color-accent)',
          color: 'oklch(12% 0.01 260)',
          border: 'none',
          cursor: 'pointer',
          fontSize: 'var(--text-sm)',
        }}
      >
        {provider ? `Try connecting ${provider} again` : 'Go back'}
      </button>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function mapErrorCode(code: string | null): string {
  switch (code) {
    case 'access_denied':
      return 'You declined the permission request. Please try again and grant the required access.';
    case 'state_mismatch':
      return 'The session state is invalid. Please start over.';
    case 'token_exchange_failed':
      return "We couldn't exchange the authorization code. Please try again.";
    default:
      return 'The connection could not be completed. Please try again.';
  }
}

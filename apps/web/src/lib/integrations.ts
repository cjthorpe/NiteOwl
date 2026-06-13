import type { ActivityProvider } from '@niteowl/types';

export interface IntegrationMeta {
  provider: ActivityProvider;
  name: string;
  description: string;
  /** What data this integration captures — shown on the card */
  captures: string[];
  /** Tailwind bg class for the logo container glow */
  accentClass: string;
  /** OKLCH color for the provider's brand */
  brandColor: string;
}

export const INTEGRATIONS: IntegrationMeta[] = [
  {
    provider: 'github',
    name: 'GitHub',
    description: 'Track pull requests, commits, and code reviews.',
    captures: ['Pull requests', 'Commits', 'Code reviews', 'Issues'],
    accentClass: 'ring-white/20',
    brandColor: 'oklch(95% 0 0)',
  },
  {
    provider: 'linear',
    name: 'Linear',
    description: 'Sync issues, cycles, and project activity.',
    captures: ['Issues', 'Cycles', 'Projects', 'Comments'],
    accentClass: 'ring-violet-400/30',
    brandColor: 'oklch(68% 0.22 278)',
  },
  {
    provider: 'jira',
    name: 'Jira',
    description: 'Import tickets, sprints, and board updates.',
    captures: ['Tickets', 'Sprints', 'Board activity', 'Comments'],
    accentClass: 'ring-blue-400/30',
    brandColor: 'oklch(58% 0.2 250)',
  },
];

export function getIntegration(provider: ActivityProvider): IntegrationMeta | undefined {
  return INTEGRATIONS.find((i) => i.provider === provider);
}

/** The provider we always require in step 1 */
export const PRIMARY_PROVIDER: ActivityProvider = 'github';

/** Providers available to connect in step 2 (optional extras) */
export const OPTIONAL_PROVIDERS: ActivityProvider[] = ['linear', 'jira'];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const API_URL = (import.meta as any).env?.VITE_API_URL ?? 'http://localhost:3000';

export function buildOAuthStartUrl(provider: ActivityProvider): string {
  // The API auth route initiates OAuth server-side. The callback redirect_uri
  // is configured on the API via API_URL/WEB_URL env vars, not the frontend.
  return `${API_URL}/auth/${provider}`;
}

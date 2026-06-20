import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ActivityProvider } from '@niteowl/types';

export type TimeHours = 8 | 12 | 24;

export interface FeedFilters {
  hours: TimeHours;
  providers: ActivityProvider[];
  repo: string;
}

const VALID_HOURS: TimeHours[] = [8, 12, 24];

function parseHours(raw: string | null): TimeHours {
  const n = Number(raw);
  return (VALID_HOURS as number[]).includes(n) ? (n as TimeHours) : 8;
}

function parseProviders(raw: string | null): ActivityProvider[] {
  if (!raw) return [];
  const valid: ActivityProvider[] = ['github', 'linear', 'jira', 'slack'];
  return raw.split(',').filter((p): p is ActivityProvider => valid.includes(p as ActivityProvider));
}

export function useFeedFilters(): {
  filters: FeedFilters;
  setHours: (h: TimeHours) => void;
  toggleProvider: (p: ActivityProvider) => void;
  setRepo: (r: string) => void;
  reset: () => void;
} {
  const [params, setParams] = useSearchParams();

  const filters: FeedFilters = {
    hours: parseHours(params.get('hours')),
    providers: parseProviders(params.get('provider')),
    repo: params.get('repo') ?? '',
  };

  const setHours = useCallback(
    (h: TimeHours) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('hours', String(h));
        return next;
      });
    },
    [setParams],
  );

  const toggleProvider = useCallback(
    (p: ActivityProvider) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        const current = parseProviders(prev.get('provider'));
        const updated = current.includes(p) ? current.filter((x) => x !== p) : [...current, p];
        if (updated.length === 0) {
          next.delete('provider');
        } else {
          next.set('provider', updated.join(','));
        }
        return next;
      });
    },
    [setParams],
  );

  const setRepo = useCallback(
    (r: string) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        if (r) {
          next.set('repo', r);
        } else {
          next.delete('repo');
        }
        return next;
      });
    },
    [setParams],
  );

  const reset = useCallback(() => {
    setParams(new URLSearchParams());
  }, [setParams]);

  return { filters, setHours, toggleProvider, setRepo, reset };
}

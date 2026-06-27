// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ALL_INTEGRATIONS,
  ALL_EVENT_TYPES,
  DEFAULT_FILTERS,
  type EventType,
  type FilterState,
  type Integration,
  type TimeRange,
} from '../types/filters';

const PARAM_TIME = 'time';
const PARAM_INTEGRATIONS = 'integrations';
const PARAM_EVENTS = 'events';

function isTimeRange(value: string): value is TimeRange {
  return ['8h', '12h', '24h', 'custom'].includes(value);
}

function parseIntegrations(raw: string | null): Integration[] {
  if (!raw) return [];
  return raw.split(',').filter((v): v is Integration => (ALL_INTEGRATIONS as string[]).includes(v));
}

function parseEventTypes(raw: string | null): EventType[] {
  if (!raw) return [];
  return raw.split(',').filter((v): v is EventType => (ALL_EVENT_TYPES as string[]).includes(v));
}

export interface UseFiltersReturn {
  filters: FilterState;
  setTimeRange: (range: TimeRange) => void;
  toggleIntegration: (integration: Integration) => void;
  toggleEventType: (eventType: EventType) => void;
  removeIntegration: (integration: Integration) => void;
  removeEventType: (eventType: EventType) => void;
  clearAll: () => void;
  hasActiveFilters: boolean;
}

export function useFilters(): UseFiltersReturn {
  const [searchParams, setSearchParams] = useSearchParams();

  const rawTime = searchParams.get(PARAM_TIME);
  const timeRange: TimeRange =
    rawTime && isTimeRange(rawTime) ? rawTime : DEFAULT_FILTERS.timeRange;
  const integrations = parseIntegrations(searchParams.get(PARAM_INTEGRATIONS));
  const eventTypes = parseEventTypes(searchParams.get(PARAM_EVENTS));

  const filters: FilterState = { timeRange, integrations, eventTypes };

  const hasActiveFilters =
    timeRange !== DEFAULT_FILTERS.timeRange || integrations.length > 0 || eventTypes.length > 0;

  const setTimeRange = useCallback(
    (range: TimeRange) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (range === DEFAULT_FILTERS.timeRange) {
            next.delete(PARAM_TIME);
          } else {
            next.set(PARAM_TIME, range);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const toggleIntegration = useCallback(
    (integration: Integration) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const current = parseIntegrations(prev.get(PARAM_INTEGRATIONS));
          const updated = current.includes(integration)
            ? current.filter((i) => i !== integration)
            : [...current, integration];

          if (updated.length === 0) {
            next.delete(PARAM_INTEGRATIONS);
          } else {
            next.set(PARAM_INTEGRATIONS, updated.join(','));
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const toggleEventType = useCallback(
    (eventType: EventType) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const current = parseEventTypes(prev.get(PARAM_EVENTS));
          const updated = current.includes(eventType)
            ? current.filter((e) => e !== eventType)
            : [...current, eventType];

          if (updated.length === 0) {
            next.delete(PARAM_EVENTS);
          } else {
            next.set(PARAM_EVENTS, updated.join(','));
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const removeIntegration = useCallback(
    (integration: Integration) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const current = parseIntegrations(prev.get(PARAM_INTEGRATIONS));
          const updated = current.filter((i) => i !== integration);

          if (updated.length === 0) {
            next.delete(PARAM_INTEGRATIONS);
          } else {
            next.set(PARAM_INTEGRATIONS, updated.join(','));
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const removeEventType = useCallback(
    (eventType: EventType) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const current = parseEventTypes(prev.get(PARAM_EVENTS));
          const updated = current.filter((e) => e !== eventType);

          if (updated.length === 0) {
            next.delete(PARAM_EVENTS);
          } else {
            next.set(PARAM_EVENTS, updated.join(','));
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const clearAll = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(PARAM_TIME);
        next.delete(PARAM_INTEGRATIONS);
        next.delete(PARAM_EVENTS);
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  return {
    filters,
    setTimeRange,
    toggleIntegration,
    toggleEventType,
    removeIntegration,
    removeEventType,
    clearAll,
    hasActiveFilters,
  };
}

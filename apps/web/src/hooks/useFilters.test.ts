import { renderHook, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import React from 'react';
import { useFilters } from './useFilters';

function wrapper({ initialSearch = '' }: { initialSearch?: string } = {}) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(MemoryRouter, { initialEntries: [`/${initialSearch}`] }, children);
  };
}

describe('useFilters', () => {
  it('returns default filters when no URL params are set', () => {
    const { result } = renderHook(() => useFilters(), { wrapper: wrapper() });
    expect(result.current.filters.timeRange).toBe('8h');
    expect(result.current.filters.integrations).toEqual([]);
    expect(result.current.filters.eventTypes).toEqual([]);
    expect(result.current.hasActiveFilters).toBe(false);
  });

  it('parses time range from URL', () => {
    const { result } = renderHook(() => useFilters(), {
      wrapper: wrapper({ initialSearch: '?time=12h' }),
    });
    expect(result.current.filters.timeRange).toBe('12h');
    expect(result.current.hasActiveFilters).toBe(true);
  });

  it('falls back to default for unknown time range', () => {
    const { result } = renderHook(() => useFilters(), {
      wrapper: wrapper({ initialSearch: '?time=99h' }),
    });
    expect(result.current.filters.timeRange).toBe('8h');
  });

  it('parses integrations from URL', () => {
    const { result } = renderHook(() => useFilters(), {
      wrapper: wrapper({ initialSearch: '?integrations=github,slack' }),
    });
    expect(result.current.filters.integrations).toEqual(['github', 'slack']);
  });

  it('ignores unknown integrations', () => {
    const { result } = renderHook(() => useFilters(), {
      wrapper: wrapper({ initialSearch: '?integrations=github,unknown' }),
    });
    expect(result.current.filters.integrations).toEqual(['github']);
  });

  it('parses event types from URL', () => {
    const { result } = renderHook(() => useFilters(), {
      wrapper: wrapper({ initialSearch: '?events=prs,commits' }),
    });
    expect(result.current.filters.eventTypes).toEqual(['prs', 'commits']);
  });

  it('setTimeRange updates the time range', () => {
    const { result } = renderHook(() => useFilters(), { wrapper: wrapper() });
    act(() => {
      result.current.setTimeRange('24h');
    });
    expect(result.current.filters.timeRange).toBe('24h');
    expect(result.current.hasActiveFilters).toBe(true);
  });

  it('setTimeRange to default removes the param', () => {
    const { result } = renderHook(() => useFilters(), {
      wrapper: wrapper({ initialSearch: '?time=24h' }),
    });
    act(() => {
      result.current.setTimeRange('8h');
    });
    expect(result.current.filters.timeRange).toBe('8h');
    expect(result.current.hasActiveFilters).toBe(false);
  });

  it('toggleIntegration adds an integration', () => {
    const { result } = renderHook(() => useFilters(), { wrapper: wrapper() });
    act(() => {
      result.current.toggleIntegration('github');
    });
    expect(result.current.filters.integrations).toEqual(['github']);
  });

  it('toggleIntegration removes an existing integration', () => {
    const { result } = renderHook(() => useFilters(), {
      wrapper: wrapper({ initialSearch: '?integrations=github,linear' }),
    });
    act(() => {
      result.current.toggleIntegration('github');
    });
    expect(result.current.filters.integrations).toEqual(['linear']);
  });

  it('toggleEventType adds an event type', () => {
    const { result } = renderHook(() => useFilters(), { wrapper: wrapper() });
    act(() => {
      result.current.toggleEventType('prs');
    });
    expect(result.current.filters.eventTypes).toEqual(['prs']);
  });

  it('toggleEventType removes an existing event type', () => {
    const { result } = renderHook(() => useFilters(), {
      wrapper: wrapper({ initialSearch: '?events=prs,commits' }),
    });
    act(() => {
      result.current.toggleEventType('prs');
    });
    expect(result.current.filters.eventTypes).toEqual(['commits']);
  });

  it('removeIntegration removes a single integration', () => {
    const { result } = renderHook(() => useFilters(), {
      wrapper: wrapper({ initialSearch: '?integrations=github,slack' }),
    });
    act(() => {
      result.current.removeIntegration('github');
    });
    expect(result.current.filters.integrations).toEqual(['slack']);
  });

  it('removeEventType removes a single event type', () => {
    const { result } = renderHook(() => useFilters(), {
      wrapper: wrapper({ initialSearch: '?events=prs,issues' }),
    });
    act(() => {
      result.current.removeEventType('issues');
    });
    expect(result.current.filters.eventTypes).toEqual(['prs']);
  });

  it('clearAll resets all filters', () => {
    const { result } = renderHook(() => useFilters(), {
      wrapper: wrapper({ initialSearch: '?time=24h&integrations=github&events=prs' }),
    });
    act(() => {
      result.current.clearAll();
    });
    expect(result.current.filters.timeRange).toBe('8h');
    expect(result.current.filters.integrations).toEqual([]);
    expect(result.current.filters.eventTypes).toEqual([]);
    expect(result.current.hasActiveFilters).toBe(false);
  });

  it('hasActiveFilters is true when integrations are set', () => {
    const { result } = renderHook(() => useFilters(), {
      wrapper: wrapper({ initialSearch: '?integrations=jira' }),
    });
    expect(result.current.hasActiveFilters).toBe(true);
  });

  it('hasActiveFilters is true when event types are set', () => {
    const { result } = renderHook(() => useFilters(), {
      wrapper: wrapper({ initialSearch: '?events=reviews' }),
    });
    expect(result.current.hasActiveFilters).toBe(true);
  });
});

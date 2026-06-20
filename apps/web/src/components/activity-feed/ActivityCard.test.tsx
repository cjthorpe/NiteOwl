import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ActivityCard } from './ActivityCard';
import type { Activity } from '@niteowl/types';

function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: 'evt-1',
    userId: 'user-1',
    provider: 'github',
    eventType: 'pr_opened',
    sourceId: 'ext-1',
    title: 'feat: add new feature',
    url: 'https://github.com/org/repo/pull/42',
    metadata: { repo: 'org/repo' },
    occurredAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    ingestedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('ActivityCard', () => {
  it('renders event type badge', () => {
    render(<ActivityCard activity={makeActivity()} />);
    expect(screen.getByText('PR opened')).toBeInTheDocument();
  });

  it('renders the title as a link to the URL', () => {
    const activity = makeActivity({
      title: 'fix: resolve crash on startup',
      url: 'https://github.com/org/repo/pull/99',
    });
    render(<ActivityCard activity={activity} />);
    const link = screen.getByRole('link', { name: /fix: resolve crash on startup/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', 'https://github.com/org/repo/pull/99');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders repo from metadata', () => {
    render(<ActivityCard activity={makeActivity({ metadata: { repo: 'myorg/myrepo' } })} />);
    expect(screen.getByText('myorg/myrepo')).toBeInTheDocument();
  });

  it('omits repo when metadata has none', () => {
    const { container } = render(<ActivityCard activity={makeActivity({ metadata: {} })} />);
    expect(container.querySelector('.activity-card-repo')).not.toBeInTheDocument();
  });

  it('renders a relative timestamp', () => {
    render(<ActivityCard activity={makeActivity()} />);
    expect(screen.getByText(/ago|just now/i)).toBeInTheDocument();
  });

  it('renders event type directly when not in labels map', () => {
    // comment_created is a valid type but not in the labels dict in ActivityCard
    render(<ActivityCard activity={makeActivity({ eventType: 'comment_created' })} />);
    expect(screen.getByText('comment_created')).toBeInTheDocument();
  });

  it('renders as an article element', () => {
    render(<ActivityCard activity={makeActivity()} />);
    expect(screen.getByRole('article')).toBeInTheDocument();
  });

  it('renders commit_pushed badge with correct label', () => {
    render(<ActivityCard activity={makeActivity({ eventType: 'commit_pushed' })} />);
    expect(screen.getByText('Commit')).toBeInTheDocument();
  });

  it('renders issue_opened badge with correct label', () => {
    render(
      <ActivityCard activity={makeActivity({ provider: 'linear', eventType: 'issue_opened' })} />,
    );
    expect(screen.getByText('Issue opened')).toBeInTheDocument();
  });
});

import './morning-briefing.css';
import { useMorningBriefing } from '../../hooks/useMorningBriefing';
import { SummaryBar } from './SummaryBar';
import { AgentGroupCard } from './AgentGroupCard';

function BriefingSkeleton() {
  return (
    <>
      <div className="briefing-skeleton-bar" aria-hidden="true">
        <div className="briefing-skeleton-card" />
        <div className="briefing-skeleton-card" />
        <div className="briefing-skeleton-card" />
        <div className="briefing-skeleton-card" />
      </div>
      <div
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}
        aria-hidden="true"
      >
        <div className="briefing-skeleton-group" />
        <div className="briefing-skeleton-group" />
        <div className="briefing-skeleton-group" />
      </div>
      <span className="sr-only">Loading morning briefing…</span>
    </>
  );
}

export function MorningBriefing() {
  const { data, isLoading, isError, refetch } = useMorningBriefing();

  if (isLoading) return <BriefingSkeleton />;

  if (isError) {
    return (
      <div className="briefing-empty" role="alert">
        <p className="briefing-empty-title">Unable to load briefing</p>
        <p className="briefing-empty-body">
          <button
            type="button"
            onClick={() => void refetch()}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-accent)',
              cursor: 'pointer',
              font: 'inherit',
              padding: 0,
            }}
          >
            Retry
          </button>
        </p>
      </div>
    );
  }

  if (!data || data.totalItems === 0) {
    return (
      <div className="briefing-empty">
        <p className="briefing-empty-title">All quiet since your last login</p>
        <p className="briefing-empty-body">No agent activity to report.</p>
      </div>
    );
  }

  return (
    <div aria-label="Morning briefing" role="region">
      <SummaryBar summary={data.summary} />

      <div className="briefing-agent-list" aria-label="Activity by agent">
        {data.agentGroups.map((group) => (
          <AgentGroupCard key={group.login} group={group} />
        ))}
      </div>
    </div>
  );
}

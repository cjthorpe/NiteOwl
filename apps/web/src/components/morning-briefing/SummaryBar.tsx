import type { BriefingSummary } from '../../hooks/useMorningBriefing';

interface SummaryBarProps {
  summary: BriefingSummary;
}

interface StatProps {
  value: number;
  label: string;
  ariaLabel: string;
  highlight?: boolean;
}

function Stat({ value, label, ariaLabel, highlight }: StatProps) {
  return (
    <div
      className="summary-stat"
      data-highlight={highlight ? 'true' : undefined}
      role="status"
      aria-label={ariaLabel}
    >
      <span className="summary-stat-value" aria-hidden="true">
        {value}
      </span>
      <span className="summary-stat-label">{label}</span>
    </div>
  );
}

export function SummaryBar({ summary }: SummaryBarProps) {
  return (
    <div
      className="briefing-summary-bar"
      aria-label="Morning briefing summary"
      role="region"
    >
      <Stat
        value={summary.totalPrsMerged}
        label="PRs merged"
        ariaLabel={`${summary.totalPrsMerged} pull requests merged`}
        highlight={summary.totalPrsMerged > 0}
      />
      <Stat
        value={summary.totalIssuesClosed}
        label="Issues closed"
        ariaLabel={`${summary.totalIssuesClosed} issues closed`}
      />
      <Stat
        value={summary.totalCommitsPushed}
        label="Commits pushed"
        ariaLabel={`${summary.totalCommitsPushed} commits pushed`}
      />
      <Stat
        value={summary.totalPrsOpened}
        label="PRs opened"
        ariaLabel={`${summary.totalPrsOpened} pull requests opened — may need review`}
        highlight={summary.totalPrsOpened > 0}
      />
    </div>
  );
}

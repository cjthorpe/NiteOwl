import type { Activity } from '@niteowl/types';
import { ProviderLogo } from '../ui/ProviderLogo';
import { formatTimestamp, toDatetimeAttr } from '../../lib/time';

const EVENT_TYPE_LABELS: Record<string, string> = {
  pr_opened: 'PR opened',
  pr_merged: 'PR merged',
  pr_closed: 'PR closed',
  commit_pushed: 'Commit',
  issue_opened: 'Issue opened',
  issue_closed: 'Issue closed',
  issue_updated: 'Issue updated',
};

function extractRepo(activity: Activity): string {
  const meta = activity.metadata;
  if (typeof meta['repo'] === 'string') return meta['repo'];
  if (typeof meta['repository'] === 'string') return meta['repository'];
  if (typeof meta['project'] === 'string') return meta['project'];
  return '';
}

interface ActivityCardProps {
  activity: Activity;
}

export function ActivityCard({ activity }: ActivityCardProps) {
  const repo = extractRepo(activity);
  const label = EVENT_TYPE_LABELS[activity.eventType] ?? activity.eventType;
  const timestamp = formatTimestamp(activity.occurredAt);

  return (
    <article className="activity-card">
      <div className="activity-card-icon-col">
        <div
          className="activity-card-icon"
          data-provider={activity.provider}
          aria-hidden="true"
        >
          <ProviderLogo provider={activity.provider} size={16} />
        </div>
      </div>

      <div className="activity-card-body">
        <div className="activity-card-meta">
          <span
            className="activity-card-badge"
            data-event={activity.eventType}
          >
            {label}
          </span>
          {repo && (
            <span className="activity-card-repo" title={repo}>
              {repo}
            </span>
          )}
        </div>

        <p className="activity-card-title">
          <a
            href={activity.url}
            target="_blank"
            rel="noopener noreferrer"
            tabIndex={0}
            aria-label={`${label}: ${activity.title}${repo ? ` in ${repo}` : ''}`}
          >
            {activity.title}
          </a>
        </p>

        <time
          className="activity-card-timestamp"
          dateTime={toDatetimeAttr(activity.occurredAt)}
          title={new Date(activity.occurredAt).toLocaleString()}
        >
          {timestamp}
        </time>
      </div>
    </article>
  );
}

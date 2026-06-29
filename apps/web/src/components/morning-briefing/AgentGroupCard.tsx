// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import type { AgentGroup } from '../../hooks/useMorningBriefing';
import { UNKNOWN_AUTHOR_LOGIN } from '../../lib/briefing-digest';
import { formatTimestamp, toDatetimeAttr } from '../../lib/time';

/** Standalone, title-case label for the unknown-actor bucket (FUL-139). */
const UNKNOWN_DISPLAY_NAME = 'Unknown contributor';

const EVENT_LABELS: Record<string, string> = {
  pr_opened: 'PR opened',
  pr_merged: 'PR merged',
  pr_closed: 'PR closed',
  commit_pushed: 'Commit',
  issue_opened: 'Issue opened',
  issue_closed: 'Issue closed',
  issue_updated: 'Issue updated',
  comment_created: 'Comment',
};

function extractRepo(metadata: Record<string, unknown>): string {
  if (typeof metadata['repo'] === 'string') return metadata['repo'];
  if (typeof metadata['repository'] === 'string') return metadata['repository'];
  if (typeof metadata['project'] === 'string') return metadata['project'];
  return '';
}

function isUnknownLogin(login: string): boolean {
  return login === UNKNOWN_AUTHOR_LOGIN;
}

/** First letter for the avatar; a neutral glyph for the unknown bucket (never "(", FUL-139). */
function avatarInitial(login: string): string {
  if (isUnknownLogin(login)) return '?';
  const initial = login.trim().charAt(0).toUpperCase();
  return initial || '?';
}

/** Human-facing contributor name; the sentinel becomes a friendly label (FUL-139). */
function displayName(login: string): string {
  return isUnknownLogin(login) ? UNKNOWN_DISPLAY_NAME : login;
}

interface AgentGroupCardProps {
  group: AgentGroup;
}

export function AgentGroupCard({ group }: AgentGroupCardProps) {
  const unreviewedCount = group.unreviewedPrs.length;
  const name = displayName(group.login);

  return (
    <section className="agent-group" aria-label={`Activity for ${name}`}>
      <header className="agent-group-header">
        <div className="agent-group-name">
          <div className="agent-group-avatar" aria-hidden="true">
            {avatarInitial(group.login)}
          </div>
          <span>{name}</span>
        </div>

        <div className="agent-group-chips" role="list" aria-label={`${name} stats`}>
          {group.prsMerged > 0 && (
            <span
              className="agent-chip"
              data-kind="merged"
              role="listitem"
              aria-label={`${group.prsMerged} PRs merged`}
            >
              {group.prsMerged} merged
            </span>
          )}
          {group.commitsPushed > 0 && (
            <span
              className="agent-chip"
              data-kind="commits"
              role="listitem"
              aria-label={`${group.commitsPushed} commits`}
            >
              {group.commitsPushed} commits
            </span>
          )}
          {group.issuesClosed > 0 && (
            <span
              className="agent-chip"
              data-kind="issues"
              role="listitem"
              aria-label={`${group.issuesClosed} issues closed`}
            >
              {group.issuesClosed} closed
            </span>
          )}
          {unreviewedCount > 0 && (
            <span
              className="agent-chip"
              data-kind="unreviewed"
              role="listitem"
              aria-label={`${unreviewedCount} PRs need review`}
            >
              {unreviewedCount} need review
            </span>
          )}
        </div>
      </header>

      <ul className="agent-group-items" aria-label={`Events from ${name}`}>
        {group.items.map((item) => {
          const isUnreviewed = item.eventType === 'pr_opened';
          const repo = extractRepo(item.metadata);
          const label = EVENT_LABELS[item.eventType] ?? item.eventType;

          return (
            <li
              key={item.id}
              className="agent-group-item"
              data-unreviewed={isUnreviewed ? 'true' : undefined}
              aria-label={`${label}: ${item.title}${isUnreviewed ? ' — needs review' : ''}`}
            >
              <span
                className="agent-item-event-badge"
                data-event={item.eventType}
                aria-hidden="true"
              >
                {label}
              </span>

              <div className="agent-item-body">
                <p className="agent-item-title">
                  <a href={item.url} target="_blank" rel="noopener noreferrer" tabIndex={0}>
                    {item.title}
                  </a>
                </p>
                {repo && (
                  <p className="agent-item-repo" aria-label={`Repository: ${repo}`}>
                    {repo}
                  </p>
                )}
              </div>

              <time
                className="agent-item-time"
                dateTime={toDatetimeAttr(item.occurredAt)}
                title={new Date(item.occurredAt).toLocaleString()}
              >
                {formatTimestamp(item.occurredAt)}
              </time>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

interface EmptyStateProps {
  hours: number;
}

export function EmptyState({ hours }: EmptyStateProps) {
  return (
    <div className="feed-state" role="status">
      <div className="feed-state-icon" aria-hidden="true">
        🦉
      </div>
      <p className="feed-state-title">All quiet in the last {hours}h</p>
      <p className="feed-state-message">
        No activity from your connected providers in this window. Try a longer time range, or check
        back once your integrations have synced.
      </p>
    </div>
  );
}

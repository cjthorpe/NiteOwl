// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
interface ErrorStateProps {
  onRetry: () => void;
}

export function ErrorState({ onRetry }: ErrorStateProps) {
  return (
    <div className="feed-state" role="alert">
      <div className="feed-state-icon" aria-hidden="true">
        ⚠
      </div>
      <p className="feed-state-title">Couldn't load your feed</p>
      <p className="feed-state-message">
        Something went wrong fetching your activity. Check your connection and try again.
      </p>
      <button type="button" className="feed-retry-btn" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

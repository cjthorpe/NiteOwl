// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
export function ActivityCardSkeleton() {
  return (
    <div className="skeleton-card" aria-hidden="true">
      <div className="skeleton-icon skeleton-pulse" />
      <div className="skeleton-body">
        <div className="skeleton-line skeleton-line-meta skeleton-pulse" />
        <div className="skeleton-line skeleton-line-title skeleton-pulse" />
        <div className="skeleton-line skeleton-line-ts skeleton-pulse" />
      </div>
    </div>
  );
}

export function ActivityFeedSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading activity feed">
      {Array.from({ length: count }).map((_, i) => (
        <ActivityCardSkeleton key={i} />
      ))}
    </div>
  );
}

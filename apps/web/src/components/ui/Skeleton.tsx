import './skeleton.css';

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  radius?: string;
  className?: string;
}

export function Skeleton({ width, height, radius, className }: SkeletonProps) {
  return (
    <div
      className={`skeleton${className ? ` ${className}` : ''}`}
      style={{
        width,
        height,
        borderRadius: radius ?? 'var(--radius-sm)',
      }}
      aria-hidden="true"
    />
  );
}

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          height="1em"
          width={i === lines - 1 ? '60%' : '100%'}
        />
      ))}
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div
      className="skeleton-card"
      aria-label="Loading…"
      aria-busy="true"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
        <Skeleton width={32} height={32} radius="50%" />
        <div style={{ flex: 1 }}>
          <Skeleton height="0.875em" width="40%" />
        </div>
      </div>
      <SkeletonText lines={3} />
    </div>
  );
}

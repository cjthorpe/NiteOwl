import { SkeletonCard } from '../components/ui/Skeleton';

export function Integrations() {
  return (
    <section aria-labelledby="integrations-heading">
      <header style={{ marginBottom: 'var(--space-8)' }}>
        <h1
          id="integrations-heading"
          style={{
            fontSize: 'var(--text-2xl)',
            fontWeight: 700,
            letterSpacing: '-0.03em',
            color: 'var(--color-text)',
            margin: 0,
          }}
        >
          Integrations
        </h1>
        <p
          style={{
            marginTop: 'var(--space-2)',
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text-muted)',
          }}
        >
          Connect your tools to surface activity in NiteOwl.
        </p>
      </header>

      {/* Skeleton grid — will be replaced by real integration cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 'var(--space-4)',
        }}
        aria-label="Integration cards loading"
      >
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </section>
  );
}

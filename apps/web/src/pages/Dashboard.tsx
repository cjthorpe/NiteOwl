export function Dashboard() {
  return (
    <section aria-labelledby="dashboard-heading">
      <h1
        id="dashboard-heading"
        style={{
          fontSize: 'var(--text-2xl)',
          fontWeight: 700,
          letterSpacing: '-0.03em',
          color: 'var(--color-text)',
          marginBottom: 'var(--space-6)',
        }}
      >
        Dashboard
      </h1>

      <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
        Activity feed coming soon.
      </p>
    </section>
  );
}

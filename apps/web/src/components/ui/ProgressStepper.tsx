interface Step {
  label: string;
}

interface ProgressStepperProps {
  steps: Step[];
  current: number; // 1-indexed
}

export function ProgressStepper({ steps, current }: ProgressStepperProps) {
  return (
    <nav aria-label="Setup progress" className="flex items-center gap-2">
      {steps.map((step, idx) => {
        const stepNum = idx + 1;
        const done = stepNum < current;
        const active = stepNum === current;

        return (
          <div key={step.label} className="flex items-center gap-2">
            {/* Step circle */}
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-all"
              style={{
                backgroundColor: active
                  ? 'var(--color-accent)'
                  : done
                    ? 'oklch(68% 0.18 145 / 0.18)'
                    : 'var(--color-surface-overlay)',
                color: active
                  ? 'oklch(12% 0.01 260)'
                  : done
                    ? 'var(--color-success)'
                    : 'var(--color-text-subtle)',
                border: active ? 'none' : done ? '1px solid var(--color-success)' : '1px solid var(--color-border)',
              }}
              aria-current={active ? 'step' : undefined}
            >
              {done ? (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                stepNum
              )}
            </div>

            {/* Label (visible only on active/done) */}
            <span
              className="text-xs font-medium hidden sm:inline-block"
              style={{ color: active ? 'var(--color-text)' : 'var(--color-text-subtle)' }}
            >
              {step.label}
            </span>

            {/* Connector */}
            {idx < steps.length - 1 && (
              <div
                className="h-px w-8 transition-all"
                style={{
                  backgroundColor: done ? 'var(--color-success)' : 'var(--color-border)',
                  opacity: done ? 0.6 : 1,
                }}
                aria-hidden
              />
            )}
          </div>
        );
      })}
    </nav>
  );
}

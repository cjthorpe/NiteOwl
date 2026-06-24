import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';

interface AuthFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  /** When set, the field renders in an error state and links to this message via aria-describedby. */
  errorId?: string;
  invalid?: boolean;
  /** Optional non-error helper text rendered under the input. */
  hint?: string;
  hintId?: string;
}

/**
 * Labeled text input matching the AgentSettings input treatment: token-driven
 * styling, visible focus ring via border colour, and accessible error wiring
 * (aria-invalid + aria-describedby). Forwarded ref lets callers manage focus.
 */
export const AuthField = forwardRef<HTMLInputElement, AuthFieldProps>(function AuthField(
  { id, label, errorId, invalid = false, hint, hintId, ...inputProps },
  ref,
) {
  const describedBy = [invalid ? errorId : undefined, hint ? hintId : undefined]
    .filter(Boolean)
    .join(' ');

  return (
    <div>
      <label
        htmlFor={id}
        style={{
          display: 'block',
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-muted)',
          marginBottom: 'var(--space-1)',
        }}
      >
        {label}
      </label>
      <input
        ref={ref}
        id={id}
        {...inputProps}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy || undefined}
        style={{
          width: '100%',
          background: 'var(--color-surface)',
          border: `1px solid ${invalid ? 'var(--color-danger)' : 'var(--color-border)'}`,
          borderRadius: 'var(--radius-md)',
          color: 'var(--color-text)',
          fontSize: 'var(--text-sm)',
          outline: 'none',
          padding: 'var(--space-3)',
          transition: 'border-color var(--duration-fast)',
          boxSizing: 'border-box',
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = 'var(--color-border-focus)';
          inputProps.onFocus?.(e);
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = invalid
            ? 'var(--color-danger)'
            : 'var(--color-border)';
          inputProps.onBlur?.(e);
        }}
        {...inputProps}
      />
      {hint && !invalid && (
        <p
          id={hintId}
          style={{
            margin: 'var(--space-1) 0 0',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
          }}
        >
          {hint}
        </p>
      )}
    </div>
  );
});

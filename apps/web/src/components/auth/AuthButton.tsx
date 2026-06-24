import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface AuthButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}

/** Full-width primary action button for the auth forms. Token-driven, accent fill. */
export function AuthButton({ children, disabled, style, ...rest }: AuthButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled}
      style={{
        width: '100%',
        background: disabled ? 'oklch(68% 0.22 278 / 0.5)' : 'var(--color-accent)',
        border: 'none',
        borderRadius: 'var(--radius-md)',
        color: 'oklch(98% 0 0)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: 'var(--text-sm)',
        fontWeight: 600,
        padding: 'var(--space-3) var(--space-4)',
        transition: 'background var(--duration-fast)',
        ...style,
      }}
    >
      {children}
    </button>
  );
}

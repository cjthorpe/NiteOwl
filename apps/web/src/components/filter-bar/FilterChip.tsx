interface FilterChipProps {
  label: string;
  onRemove: () => void;
}

export function FilterChip({ label, onRemove }: FilterChipProps) {
  return (
    <span className="filter-chip" role="group" aria-label={`Active filter: ${label}`}>
      <span className="filter-chip__label">{label}</span>
      <button
        type="button"
        className="filter-chip__remove"
        onClick={onRemove}
        aria-label={`Remove filter: ${label}`}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          aria-hidden="true"
          focusable="false"
        >
          <path
            d="M1 1L9 9M9 1L1 9"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </span>
  );
}

import { useEffect, useId, useRef, useState } from 'react';
import { ALL_INTEGRATIONS, INTEGRATION_LABELS, type Integration } from '../../types/filters';

interface IntegrationFilterProps {
  value: Integration[];
  onChange: (integration: Integration) => void;
}

export function IntegrationFilter({ value, onChange }: IntegrationFilterProps) {
  const [open, setOpen] = useState(false);
  const triggerId = useId();
  const listId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;

    function handlePointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  // Close on Escape
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  const selectedCount = value.length;

  return (
    <div ref={containerRef} className="integration-filter" onKeyDown={handleKeyDown}>
      <span className="filter-label" id={`${triggerId}-label`}>
        Integrations
      </span>
      <button
        type="button"
        id={triggerId}
        className={`integration-filter__trigger ${open ? 'integration-filter__trigger--open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${triggerId}-label ${triggerId}`}
        aria-controls={listId}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span>{selectedCount === 0 ? 'All' : `${selectedCount} selected`}</span>
        <svg
          className={`integration-filter__chevron ${open ? 'integration-filter__chevron--open' : ''}`}
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
          focusable="false"
        >
          <path
            d="M2 4L6 8L10 4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-multiselectable="true"
          aria-label="Select integrations"
          className="integration-filter__list"
        >
          {ALL_INTEGRATIONS.map((integration) => {
            const isSelected = value.includes(integration);
            return (
              <li
                key={integration}
                role="option"
                aria-selected={isSelected}
                className={`integration-filter__option ${isSelected ? 'integration-filter__option--selected' : ''}`}
                onClick={() => onChange(integration)}
                onKeyDown={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    onChange(integration);
                  }
                }}
                tabIndex={0}
              >
                <span className="integration-filter__checkbox" aria-hidden="true">
                  {isSelected && (
                    <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                      <path
                        d="M1 4L3.5 6.5L9 1"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </span>
                <span>{INTEGRATION_LABELS[integration]}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

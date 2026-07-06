// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { useEffect, useId, useRef, useState } from 'react';

interface TextFilterProps {
  label: string;
  /** Committed value, sourced from the URL. */
  value: string;
  /** Called with the trimmed value once the user pauses typing, blurs, or submits. */
  onCommit: (value: string) => void;
  placeholder?: string;
  /** Debounce window (ms) before an in-progress edit is committed to the URL. */
  debounceMs?: number;
}

/**
 * A debounced free-text filter input. Keystrokes update local draft state
 * immediately for responsiveness, but only commit to URL-as-state after the
 * user pauses (or blurs / presses Enter), so we don't spam history or refetch
 * on every character.
 */
export function TextFilter({
  label,
  value,
  onCommit,
  placeholder,
  debounceMs = 350,
}: TextFilterProps) {
  const inputId = useId();
  const [draft, setDraft] = useState(value);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  // Keep the draft in sync when the committed value changes externally
  // (e.g. chip removal or "Clear all").
  useEffect(() => {
    setDraft(value);
  }, [value]);

  // Debounced commit: fire only when the draft diverges from the committed value.
  useEffect(() => {
    if (draft.trim() === value) return;
    const handle = setTimeout(() => onCommitRef.current(draft), debounceMs);
    return () => clearTimeout(handle);
  }, [draft, value, debounceMs]);

  return (
    <div className="text-filter">
      <label className="filter-label" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        type="text"
        className="text-filter__input"
        value={draft}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onCommit(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onCommit(draft);
          }
        }}
      />
    </div>
  );
}

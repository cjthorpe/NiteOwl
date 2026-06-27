// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { useId } from 'react';
import { ALL_TIME_RANGES, TIME_RANGE_LABELS, type TimeRange } from '../../types/filters';

interface TimeRangeSelectorProps {
  value: TimeRange;
  onChange: (range: TimeRange) => void;
}

export function TimeRangeSelector({ value, onChange }: TimeRangeSelectorProps) {
  const groupId = useId();

  return (
    <fieldset className="time-range-selector" aria-label="Time range">
      <legend className="filter-label">Time range</legend>
      <div
        className="time-range-selector__options"
        role="group"
        aria-labelledby={`${groupId}-legend`}
      >
        {ALL_TIME_RANGES.map((range) => (
          <label key={range} className="time-range-option">
            <input
              type="radio"
              name={`${groupId}-time-range`}
              value={range}
              checked={value === range}
              onChange={() => onChange(range)}
              className="sr-only"
            />
            <span
              className={`time-range-option__label ${value === range ? 'time-range-option__label--active' : ''}`}
              aria-current={value === range ? 'true' : undefined}
            >
              {TIME_RANGE_LABELS[range]}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

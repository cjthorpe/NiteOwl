import { ALL_EVENT_TYPES, EVENT_TYPE_LABELS, type EventType } from '../../types/filters';

interface EventTypeFilterProps {
  value: EventType[];
  onChange: (eventType: EventType) => void;
}

export function EventTypeFilter({ value, onChange }: EventTypeFilterProps) {
  return (
    <fieldset className="event-type-filter">
      <legend className="filter-label">Event type</legend>
      <div className="event-type-filter__options">
        {ALL_EVENT_TYPES.map((eventType) => {
          const isActive = value.includes(eventType);
          return (
            <button
              key={eventType}
              type="button"
              className={`event-type-pill ${isActive ? 'event-type-pill--active' : ''}`}
              aria-pressed={isActive}
              onClick={() => onChange(eventType)}
            >
              {EVENT_TYPE_LABELS[eventType]}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

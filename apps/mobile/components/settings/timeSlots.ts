/**
 * The reminder scheduler runs every 15 minutes and matches to the quarter
 * hour (run_reminders, migration 0022). Offering anything finer would silently
 * round what the client picked, so the list IS the set of slots the scheduler
 * visits — 96 of them — and the constraint needs no explaining (C1a).
 */
const SLOT_MINUTES = 15;
export const ROW_HEIGHT = 46;

export interface TimeSlot {
  hour: number;
  minute: number;
  value: string;
  label: string;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatSlotLabel(hour: number, minute: number): string {
  const period = hour < 12 ? "AM" : "PM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${pad(minute)} ${period}`;
}

/** Display form of a stored "HH:MM", e.g. "08:15" -> "8:15 AM". */
export function formatStoredTime(value: string): string {
  return formatSlotLabel(Number(value.slice(0, 2)), Number(value.slice(3, 5)));
}

/** Every quarter-hour slot in a day, in order. */
export function buildSlots(): TimeSlot[] {
  const slots: TimeSlot[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    for (let minute = 0; minute < 60; minute += SLOT_MINUTES) {
      slots.push({
        hour,
        minute,
        value: `${pad(hour)}:${pad(minute)}`,
        label: formatSlotLabel(hour, minute),
      });
    }
  }
  return slots;
}

/**
 * Rounds a stored time down onto a real slot. Values predating the quarter-hour
 * picker exist, and the scheduler floors them the same way — so the field shows
 * the slot that will actually fire, not the number that was saved.
 */
export function nearestSlotValue(stored: string | null, fallback = "08:00"): string {
  const match = /^(\d{2}):(\d{2})/.exec(stored ?? "");
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return fallback;
  if (hour < 0 || hour > 23) return fallback;
  return `${pad(hour)}:${pad(Math.floor(minute / SLOT_MINUTES) * SLOT_MINUTES)}`;
}

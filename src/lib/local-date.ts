const DEFAULT_TIMEZONE = "UTC";

/**
 * `users.timezone` is free-text, never validated at write time (see users.ts) —
 * this is the one place we can't just trust it, since a garbage value throws
 * inside `Intl.DateTimeFormat` and would otherwise take down the caller.
 */
export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** Runtime compatibility check after PostgreSQL has accepted the stored zone. */
export function tryLocalDateFor(
  timezone: string | null | undefined,
  at: Date = new Date()
): string | null {
  if (timezone && !isValidTimezone(timezone)) return null;
  return localDateFor(timezone, at);
}

function resolveZone(timezone: string | null | undefined): string {
  return timezone && isValidTimezone(timezone) ? timezone : DEFAULT_TIMEZONE;
}

/** A user's local calendar day (`YYYY-MM-DD`) in their stored timezone, falling back to UTC. */
export function localDateFor(timezone: string | null | undefined, at: Date = new Date()): string {
  // en-CA renders as YYYY-MM-DD — no manual string assembly needed.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: resolveZone(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** The local hour-of-day (0-23) `at` currently falls in, for timezone-bucketed scheduling. */
export function localHourFor(timezone: string | null | undefined, at: Date = new Date()): number {
  const hourStr = new Intl.DateTimeFormat("en-US", {
    timeZone: resolveZone(timezone),
    hour: "2-digit",
    hour12: false,
  }).format(at);
  // Some ICU builds render midnight as "24" rather than "00".
  return Number(hourStr) % 24;
}

/** `deltaDays` from a `YYYY-MM-DD` string — pure calendar-date arithmetic, no timezone involved. */
export function shiftLocalDate(localDate: string, deltaDays: number): string {
  const date = new Date(`${localDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}

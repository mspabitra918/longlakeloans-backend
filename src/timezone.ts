export const APP_TIME_ZONE = "America/Los_Angeles";
/** The Pacific zone's offset from UTC, in ms, at a given instant. */
function offsetMsAt(instant: Date): number {
  const wall = new Date(
    instant.toLocaleString("en-US", { timeZone: APP_TIME_ZONE }),
  );
  const utcWall = new Date(
    instant.toLocaleString("en-US", { timeZone: "UTC" }),
  );
  return utcWall.getTime() - wall.getTime();
}

/**
 * Converts a Pacific wall-clock time (e.g. '2026-07-20T00:00:00.000') to the
 * UTC instant it refers to. The offset is applied twice because the offset
 * itself depends on the instant — the second pass settles days crossing a DST
 * edge.
 */
function pacificToUtc(localIso: string): Date {
  const asUtc = new Date(`${localIso}Z`);
  if (isNaN(asUtc.getTime())) return asUtc;
  const approx = new Date(asUtc.getTime() + offsetMsAt(asUtc));
  return new Date(asUtc.getTime() + offsetMsAt(approx));
}

/**
 * Start/end instants of a YYYY-MM-DD *Pacific* calendar day, for filtering
 * UTC-stored timestamps. The admin portal shows Pacific times, so a day picked
 * there must mean a Pacific day rather than a day in the API server's own zone.
 * Correctly yields a 23-hour window on spring-forward and 25 on fall-back.
 * Returns nulls when the date can't be parsed.
 */
export function pacificDayRange(date: string): {
  dateFrom: Date | null;
  dateTo: Date | null;
} {
  const dateFrom = pacificToUtc(`${date}T00:00:00.000`);
  const dateTo = pacificToUtc(`${date}T23:59:59.999`);
  return isNaN(dateFrom.getTime()) || isNaN(dateTo.getTime())
    ? { dateFrom: null, dateTo: null }
    : { dateFrom, dateTo };
}

export function todayStr(): string {
  // en-CA formats as YYYY-MM-DD, which is what <input type="date"> expects.
  return new Date().toLocaleDateString("en-CA", { timeZone: APP_TIME_ZONE });
}

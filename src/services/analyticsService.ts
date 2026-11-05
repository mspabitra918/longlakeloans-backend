import { query, queryOne } from "../db";
import { APP_TIME_ZONE } from "../timezone";

/**
 * Dashboard analytics for the admin portal.
 *
 * Every bucket is a *Pacific* hour/day/month so the charts line up with the
 * Pacific timestamps shown everywhere else in the admin UI. "1d" is today
 * (midnight → now, hourly), "7d/30d/90d" end today (daily), "1y" is the last
 * 12 calendar months (monthly). The comparison period is the same-length
 * window immediately before, cut at the same relative point in time, so a
 * half-finished today is compared with yesterday up to the same hour.
 */

export const ANALYTICS_RANGES = ["1d", "7d", "30d", "90d", "1y"] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

// SQL fragments are constants chosen by a whitelisted key — never user input.
// `lt` = today's Pacific midnight as a local (tz-less) timestamp.
const RANGE_SQL: Record<
  AnalyticsRange,
  { unit: "hour" | "day" | "month"; start: string; last: string; span: string }
> = {
  "1d": {
    unit: "hour",
    start: "lt",
    last: "lt + interval '23 hours'",
    span: "1 day",
  },
  "7d": {
    unit: "day",
    start: "lt - interval '6 days'",
    last: "lt",
    span: "7 days",
  },
  "30d": {
    unit: "day",
    start: "lt - interval '29 days'",
    last: "lt",
    span: "30 days",
  },
  "90d": {
    unit: "day",
    start: "lt - interval '89 days'",
    last: "lt",
    span: "90 days",
  },
  "1y": {
    unit: "month",
    start: "date_trunc('month', lt) - interval '11 months'",
    last: "date_trunc('month', lt)",
    span: "1 year",
  },
};

const DECLINED = "('declined_pb', 'declined_hd')";
const IN_PROGRESS =
  "('bank_verification_pending', 'bank_reverification', 'request_a_call')";

export interface AnalyticsPoint {
  bucket: string; // Pacific local time, "YYYY-MM-DDTHH:MM:SS"
  total: number;
  funded: number;
  declined: number;
  verified: number;
  in_progress: number;
  amount: number;
  funded_amount: number;
}

export interface AnalyticsSummary {
  total: number;
  amount: number;
  avg_amount: number;
  funded: number;
  funded_amount: number;
  declined: number;
  verified: number;
}

export interface AnalyticsResult {
  range: AnalyticsRange;
  unit: "hour" | "day" | "month";
  periodStart: string;
  generatedAt: string;
  current: AnalyticsSummary;
  previous: AnalyticsSummary;
  series: AnalyticsPoint[];
  statusBreakdown: { status: string; count: number; amount: number }[];
  topStates: { state: string; count: number; amount: number }[];
  purposes: { purpose: string; count: number; amount: number }[];
  allTimeTotal: number;
}

function boundsCte(range: AnalyticsRange): string {
  const r = RANGE_SQL[range];
  return `
    lt AS (SELECT date_trunc('day', now() AT TIME ZONE $1) AS lt),
    b AS (
      SELECT
        ${r.start} AS start_local,
        ${r.last} AS last_local,
        (${r.start}) AT TIME ZONE $1 AS start_utc,
        now() AS end_utc,
        interval '${r.span}' AS span
      FROM lt
    )`;
}

type RawSummary = Record<string, string | number | null>;

function toSummary(row: RawSummary | null, prefix: "cur" | "prev") {
  const n = (k: string) => Number(row?.[`${prefix}_${k}`] ?? 0);
  const total = n("total");
  const amount = n("amount");
  return {
    total,
    amount,
    avg_amount: total > 0 ? amount / total : 0,
    funded: n("funded"),
    funded_amount: n("funded_amount"),
    declined: n("declined"),
    verified: n("verified"),
  };
}

function summaryCols(prefix: "cur" | "prev", cond: string): string {
  return `
    COUNT(*) FILTER (WHERE ${cond})::int AS ${prefix}_total,
    COALESCE(SUM(loan_amount) FILTER (WHERE ${cond}), 0)::float AS ${prefix}_amount,
    COUNT(*) FILTER (WHERE ${cond} AND status = 'funded')::int AS ${prefix}_funded,
    COALESCE(SUM(loan_amount) FILTER (WHERE ${cond} AND status = 'funded'), 0)::float AS ${prefix}_funded_amount,
    COUNT(*) FILTER (WHERE ${cond} AND status IN ${DECLINED})::int AS ${prefix}_declined,
    COUNT(*) FILTER (WHERE ${cond} AND status = 'bank_verification_completed')::int AS ${prefix}_verified`;
}

export async function getApplicationAnalytics(
  range: AnalyticsRange,
): Promise<AnalyticsResult> {
  const { unit } = RANGE_SQL[range];
  const cte = boundsCte(range);
  const tz = [APP_TIME_ZONE];
  const inWindow = "created_at >= b.start_utc AND created_at <= b.end_utc";

  const [series, summary, statusRows, stateRows, purposeRows, allTime] =
    await Promise.all([
      query<AnalyticsPoint & { bucket: string }>(
        `WITH ${cte},
         buckets AS (
           SELECT generate_series(b.start_local, b.last_local, interval '1 ${unit}') AS bucket FROM b
         ),
         apps AS (
           SELECT date_trunc('${unit}', a.created_at AT TIME ZONE $1) AS bucket,
                  a.status, a.loan_amount
           FROM loan_applications a, b
           WHERE a.created_at >= b.start_utc AND a.created_at <= b.end_utc
         )
         SELECT to_char(bk.bucket, 'YYYY-MM-DD"T"HH24:MI:SS') AS bucket,
           COUNT(ap.status)::int AS total,
           COUNT(*) FILTER (WHERE ap.status = 'funded')::int AS funded,
           COUNT(*) FILTER (WHERE ap.status IN ${DECLINED})::int AS declined,
           COUNT(*) FILTER (WHERE ap.status = 'bank_verification_completed')::int AS verified,
           COUNT(*) FILTER (WHERE ap.status IN ${IN_PROGRESS})::int AS in_progress,
           COALESCE(SUM(ap.loan_amount), 0)::float AS amount,
           COALESCE(SUM(ap.loan_amount) FILTER (WHERE ap.status = 'funded'), 0)::float AS funded_amount
         FROM buckets bk
         LEFT JOIN apps ap ON ap.bucket = bk.bucket
         GROUP BY bk.bucket
         ORDER BY bk.bucket`,
        tz,
      ),
      queryOne<RawSummary & { period_start: string }>(
        `WITH ${cte}
         SELECT
           to_char(MIN(b.start_local), 'YYYY-MM-DD"T"HH24:MI:SS') AS period_start,
           ${summaryCols("cur", "created_at >= b.start_utc")},
           ${summaryCols("prev", "created_at >= b.start_utc - b.span AND created_at <= b.end_utc - b.span")}
         FROM b
         LEFT JOIN loan_applications
           ON created_at >= b.start_utc - b.span AND created_at <= b.end_utc`,
        tz,
      ),
      query<{ status: string; count: number; amount: number }>(
        `WITH ${cte}
         SELECT status, COUNT(*)::int AS count, COALESCE(SUM(loan_amount), 0)::float AS amount
         FROM loan_applications, b WHERE ${inWindow}
         GROUP BY status ORDER BY count DESC`,
        tz,
      ),
      query<{ state: string; count: number; amount: number }>(
        `WITH ${cte}
         SELECT state, COUNT(*)::int AS count, COALESCE(SUM(loan_amount), 0)::float AS amount
         FROM loan_applications, b WHERE ${inWindow}
         GROUP BY state ORDER BY count DESC, state LIMIT 8`,
        tz,
      ),
      query<{ purpose: string; count: number; amount: number }>(
        `WITH ${cte}
         SELECT loan_purpose AS purpose, COUNT(*)::int AS count, COALESCE(SUM(loan_amount), 0)::float AS amount
         FROM loan_applications, b WHERE ${inWindow}
         GROUP BY loan_purpose ORDER BY count DESC LIMIT 8`,
        tz,
      ),
      queryOne<{ count: number }>(
        "SELECT COUNT(*)::int AS count FROM loan_applications",
      ),
    ]);

  return {
    range,
    unit,
    periodStart: summary?.period_start ?? "",
    generatedAt: new Date().toISOString(),
    current: toSummary(summary, "cur"),
    previous: toSummary(summary, "prev"),
    series,
    statusBreakdown: statusRows,
    topStates: stateRows,
    purposes: purposeRows,
    allTimeTotal: allTime?.count ?? 0,
  };
}

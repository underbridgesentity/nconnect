/**
 * Display formatting for dates and times (spec §2: timestamps are stored UTC
 * and displayed in Africa/Johannesburg).
 *
 * Every formatter pins both locale and time zone, so a server render and a
 * client render of the same instant always produce the same string. Never
 * format a timestamp with a bare toLocaleDateString(): on Vercel that renders
 * in UTC and shows South African users the wrong day either side of midnight.
 */

const TZ = "Africa/Johannesburg";
const LOCALE = "en-ZA";

export type DateInput = Date | string | number | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  // Date-only strings ("2026-07-27") are calendar dates, not instants. Parsing
  // them as UTC midnight and formatting in SAST would still land on the same
  // day (SAST is UTC+2), so this is safe and keeps the value stable.
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "27 Jul 2026" */
export function formatDate(value: DateInput, fallback = "-"): string {
  const date = toDate(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: TZ,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

/** "27 Jul 2026, 14:32" */
export function formatDateTime(value: DateInput, fallback = "-"): string {
  const date = toDate(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: TZ,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** "14:32" */
export function formatTime(value: DateInput, fallback = "-"): string {
  const date = toDate(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** "27 July 2026", for letters, invoices and legal copy. */
export function formatDateLong(value: DateInput, fallback = "-"): string {
  const date = toDate(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: TZ,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

/**
 * "3 days ago", "in 2 hours". Pass `now` explicitly from a client component so
 * the value cannot drift between the server render and hydration.
 */
export function formatRelative(
  value: DateInput,
  now: DateInput = new Date(),
  fallback = "-"
): string {
  const date = toDate(value);
  const base = toDate(now);
  if (!date || !base) return fallback;

  const diffSeconds = Math.round((date.getTime() - base.getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, seconds] of units) {
    if (Math.abs(diffSeconds) >= seconds) {
      return rtf.format(Math.round(diffSeconds / seconds), unit);
    }
  }
  return rtf.format(diffSeconds, "second");
}

/**
 * How long something has been waiting, as a compact operator-facing badge:
 * "4m", "3h", "2d". Used in the inbox and the Today queue.
 */
export function formatAge(value: DateInput, now: DateInput = new Date()): string {
  const date = toDate(value);
  const base = toDate(now);
  if (!date || !base) return "-";
  const minutes = Math.max(
    0,
    Math.floor((base.getTime() - date.getTime()) / 60000)
  );
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

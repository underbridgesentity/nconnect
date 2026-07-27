import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Canonical UUID form, exactly what a Postgres `uuid` column accepts.
 * Deliberately lenient about version and variant nibbles so it never rejects
 * an id the database itself would have stored.
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Guard a route param before it reaches a query. Passing a non-UUID string to
 * a `uuid` column throws `22P02 invalid input syntax`, which surfaces as a bare
 * 500 instead of a 404, so call `notFound()` when this returns false.
 */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value)
}

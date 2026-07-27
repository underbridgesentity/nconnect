/**
 * Route params land straight in `uuid` column comparisons. A mangled link (an
 * SMS client that clipped the URL, an old bookmark, a copy-paste that lost a
 * character) would otherwise make Postgres raise 22P02 and 500 the page.
 * Guard with this and call notFound() instead, so the customer gets the
 * branded portal 404.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string | undefined | null): boolean {
  return typeof value === "string" && UUID_RE.test(value);
}

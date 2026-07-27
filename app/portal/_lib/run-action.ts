"use client";

/**
 * Server actions handle their own failures into `{ ok: false, error }`, but a
 * dropped connection, a 500 or a redeploy mid-flight rejects the promise
 * instead. An unhandled rejection inside a transition escalates to the nearest
 * error boundary, which on this surface means a customer loses the page and
 * everything they typed.
 *
 * Wrap every call site in this: a rejection becomes an ordinary failed result,
 * the form keeps its contents, and the customer gets a retry.
 */

export const CONNECTION_ERROR =
  "We could not reach the server. Check your connection and try again, nothing you typed was lost.";

export async function runAction<T extends { ok: boolean; error?: string }>(
  call: () => Promise<T>
): Promise<T> {
  try {
    return await call();
  } catch (err) {
    console.error("portal action failed:", err);
    // Every Result type on this surface is `{ ok, error?, ...extras }`, and
    // extras are only read on the success branch, so this shape is safe.
    return { ok: false, error: CONNECTION_ERROR } as unknown as T;
  }
}

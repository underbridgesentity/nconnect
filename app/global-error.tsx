"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary: catches errors thrown in the root layout itself, so it
 * must render its own html and body and cannot rely on app styles loading.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("global error:", error);
  }, [error]);

  return (
    <html lang="en-ZA">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#121829",
          color: "#ffffff",
          fontFamily:
            "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
          padding: "2rem",
        }}
      >
        <div style={{ maxWidth: "32rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.75rem", fontWeight: 700, margin: 0 }}>
            Needd Connect is temporarily unavailable.
          </h1>
          <p
            style={{
              marginTop: "0.75rem",
              color: "rgba(255,255,255,0.7)",
              lineHeight: 1.6,
            }}
          >
            We hit an unexpected problem. Please try again in a moment.
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: "1.5rem",
              minHeight: "44px",
              padding: "0 1.5rem",
              borderRadius: "9999px",
              border: "none",
              backgroundColor: "#136fb0",
              color: "#ffffff",
              fontSize: "0.875rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {error.digest ? (
            <p
              style={{
                marginTop: "2rem",
                fontSize: "0.75rem",
                color: "rgba(255,255,255,0.5)",
              }}
            >
              Reference: {error.digest}
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}

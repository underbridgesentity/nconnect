import { ImageResponse } from "next/og";

/**
 * The share card for every public page.
 *
 * Sales reps and customers send plan, bundle and quote links on WhatsApp,
 * which is this company's primary channel. Without an image at the ratio the
 * scrapers crop to, those links render as a bare grey URL, which reads as a
 * scam link to a South African consumer. Drawn rather than photographed so it
 * is a real 1200x630 PNG, which LinkedIn and WhatsApp both render (they do
 * not reliably render WebP).
 */

export const alt = "Needd Connect, one provider, one bill, local support";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#121829",
          backgroundImage:
            "radial-gradient(110% 120% at 12% 108%, #1d2a4e 0%, #151d36 45%, #121829 78%)",
          padding: "72px 80px",
          color: "#ffffff",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 76,
              height: 76,
              borderRadius: 24,
              backgroundColor: "#136fb0",
              fontSize: 44,
              fontWeight: 700,
            }}
          >
            N
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 38,
              fontWeight: 600,
              letterSpacing: -0.5,
            }}
          >
            Needd Connect
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          {/* Broken by hand so the line never splits across the hyphen. */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontSize: 76,
              fontWeight: 700,
              letterSpacing: -2,
              lineHeight: 1.08,
            }}
          >
            <div style={{ display: "flex" }}>Internet without</div>
            <div style={{ display: "flex" }}>the run-around.</div>
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 24,
              fontSize: 32,
              color: "rgba(255,255,255,0.72)",
            }}
          >
            Uncapped LTE, 5G and fibre. One provider, one bill, local support.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: "1px solid rgba(255,255,255,0.14)",
            paddingTop: 28,
            fontSize: 26,
            color: "rgba(255,255,255,0.6)",
          }}
        >
          <div style={{ display: "flex" }}>needdconnect.co.za</div>
          <div style={{ display: "flex" }}>
            Accredited reseller of MTN, Vodacom and Telkom
          </div>
        </div>
      </div>
    ),
    size
  );
}

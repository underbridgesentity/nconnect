# Marketing image manifest

Every marketing image slot in the build (spec §11 imagery policy). The
client sources these via Freepik; until an image is loaded each slot renders
its designed gradient fallback, no stock photos were pulled into the build.

Art direction, applied to all: calm and real. South African homes and small
businesses, natural light, no glossy stock-smiles, no fake dashboards or
router glamour shots. People incidental, connectivity implied (a family
streaming, a salon card machine, a home office on a video call). Cool
neutral grade that sits beside #136FB0.

| Slot | Where | Size (px) | Brief |
|---|---|---|---|
| home-hero | `/` hero right panel (hidden < md) | 1200×900 | Someone working comfortably at home near a window, router visible but incidental. |
| internet-header | `/internet` header background (optional) | 1600×500 | Suburban SA rooftop line with sky, wireless reach without a tower cliché. |
| fibre-header | `/fibre` header background (optional) | 1600×500 | Fibre trench/duct detail or wall CPE, shallow depth of field. |
| voip-header | `/voip` header background (optional) | 1600×500 | Small business counter with a desk phone in use, candid. |
| sim-data-header | `/sim-data` header background (optional) | 1600×500 | Hands swapping a SIM into a MiFi on a kitchen table. |
| about-team | `/about` (optional) | 1200×800 | The real Needd team, client photo, not stock. |
| og-default | OpenGraph card fallback | 1200×630 | Brand: logo on warm near-white (#FAFAF9) with blue accent bar. |
| pwa-splash | Portal install splash (optional) | 1080×1920 | Icon mark centred on #FAFAF9. |

Delivery: webp preferred, sRGB, no text baked in. Hand to the developers or
upload via the admin uploader where a slot supports it.

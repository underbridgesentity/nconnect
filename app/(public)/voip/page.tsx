import type { Metadata } from "next";
import { CategoryPlanList } from "@/components/public/category-page";
import { PageHeader } from "@/components/public/page-header";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Business VoIP",
  description:
    "Cloud phone systems from R382/month: up to 20 extensions, call recording, IVR, per-second billing and number porting. Calls from R0.26/min.",
  alternates: { canonical: "/voip" },
};

export default async function VoipPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const { sort } = await searchParams;
  return (
    <>
      <PageHeader
        image="/marketing/voip.webp"
        imageAlt="A business owner taking a call at her desk"
        title="Business VoIP that sounds like you mean it"
      >
        <p>
          Crystal-clear calls without the cost of a traditional landline.
          Keep your existing number, get call recording and IVR, and pay per
          second: local mobile R0.69/min, Telkom landlines R0.26/min,
          international (USA/UK) R0.27/min.
        </p>
      </PageHeader>
      <div className="mx-auto max-w-6xl px-4 py-12">
        <CategoryPlanList categories={["voip"]} basePath="/voip" sort={sort} />
        <p className="mt-10 text-xs text-muted-foreground">
          3-month call time rollover. Number porting supported. Upgrades
          available at any time.
        </p>
      </div>
    </>
  );
}

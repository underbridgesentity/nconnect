import type { Metadata } from "next";
import { CategoryPlanList } from "@/components/public/category-page";

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
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Business VoIP</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        Crystal-clear calls without the cost of a traditional landline. Keep
        your existing number, get call recording and IVR, and pay per second —
        local mobile R0.69/min, Telkom landlines R0.26/min, international
        (USA/UK) R0.27/min.
      </p>
      <div className="mt-8">
        <CategoryPlanList categories={["voip"]} basePath="/voip" sort={sort} />
      </div>
      <p className="mt-8 text-xs text-muted-foreground">
        3-month call time rollover. Number porting supported. Upgrades
        available at any time.
      </p>
    </div>
  );
}

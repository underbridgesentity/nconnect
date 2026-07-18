"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { saveQuoteAction, type QuoteDraftItem } from "./actions";

export type Option = {
  id: string;
  name: string;
  priceCents: number;
  costCents: number | null;
};

function formatR(cents: number) {
  return `R${(cents / 100).toFixed(2)}`;
}

/**
 * Quote builder (spec §9.5): plans/bundles/hardware with quantities and
 * per-line discounts. Margin is visible to the rep (computed, not editable
 * cost); the §10.4 floor is enforced server-side and explained honestly.
 */
export function QuoteBuilder({
  leadId,
  leadName,
  planOptions,
  hardwareOptions,
  bundleOptions,
  floorPercent,
  noCostMaxPercent,
}: {
  leadId?: string;
  leadName?: string;
  planOptions: Option[];
  hardwareOptions: Option[];
  bundleOptions: Option[];
  floorPercent: number;
  noCostMaxPercent: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [items, setItems] = useState<QuoteDraftItem[]>([]);

  const optionFor = (item: QuoteDraftItem): Option | null =>
    item.itemType === "plan"
      ? (planOptions.find((o) => o.id === item.planId) ?? null)
      : item.itemType === "hardware"
        ? (hardwareOptions.find((o) => o.id === item.hardwareId) ?? null)
        : item.itemType === "bundle"
          ? (bundleOptions.find((o) => o.id === item.bundleId) ?? null)
          : null;

  const totals = useMemo(() => {
    let total = 0;
    let cost = 0;
    let costKnown = true;
    for (const item of items) {
      const opt = optionFor(item);
      const price =
        item.itemType === "custom"
          ? Math.round((item.customPriceRands ?? 0) * 100)
          : (opt?.priceCents ?? 0);
      const discount = Math.round((item.discountRands ?? 0) * 100);
      total += (price - discount) * item.qty;
      if (item.itemType === "custom") {
        // custom lines carry no cost
      } else if (opt?.costCents == null) {
        costKnown = false;
      } else {
        cost += opt.costCents * item.qty;
      }
    }
    return { total, margin: costKnown ? total - cost : null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, planOptions, hardwareOptions, bundleOptions]);

  const add = (itemType: QuoteDraftItem["itemType"]) =>
    setItems((prev) => [...prev, { itemType, qty: 1 }]);
  const patch = (i: number, p: Partial<QuoteDraftItem>) =>
    setItems((prev) => prev.map((item, idx) => (idx === i ? { ...item, ...p } : item)));
  const remove = (i: number) =>
    setItems((prev) => prev.filter((_, idx) => idx !== i));

  const save = (send: boolean) =>
    startTransition(async () => {
      const r = await saveQuoteAction({ leadId, items, send });
      if (r.ok) {
        toast.success(send ? "Quote sent" : "Draft saved");
        router.push("/sales/quotes");
      } else toast.error(r.error ?? "Failed", { duration: 8000 });
    });

  return (
    <div className="space-y-4">
      {leadName ? (
        <p className="rounded-lg border bg-accent p-3 text-sm text-accent-foreground">
          Quoting <span className="font-semibold">{leadName}</span>
        </p>
      ) : null}

      <div className="flex flex-wrap gap-1.5">
        <Button variant="outline" size="sm" onClick={() => add("plan")}>
          <Plus className="size-3.5" /> Plan
        </Button>
        <Button variant="outline" size="sm" onClick={() => add("hardware")}>
          <Plus className="size-3.5" /> Hardware
        </Button>
        <Button variant="outline" size="sm" onClick={() => add("bundle")}>
          <Plus className="size-3.5" /> Bundle
        </Button>
        <Button variant="outline" size="sm" onClick={() => add("custom")}>
          <Plus className="size-3.5" /> Custom line
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Add lines above. Discounts are allowed down to cost +{floorPercent}%
          margin (or {noCostMaxPercent}% off where no cost price is set) —
          deeper needs an admin.
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((item, i) => {
            const opt = optionFor(item);
            const price =
              item.itemType === "custom"
                ? Math.round((item.customPriceRands ?? 0) * 100)
                : (opt?.priceCents ?? 0);
            const discount = Math.round((item.discountRands ?? 0) * 100);
            const lineTotal = (price - discount) * item.qty;
            const lineMargin =
              item.itemType !== "custom" && opt?.costCents != null
                ? (price - discount - opt.costCents) * item.qty
                : null;
            const options =
              item.itemType === "plan"
                ? planOptions
                : item.itemType === "hardware"
                  ? hardwareOptions
                  : item.itemType === "bundle"
                    ? bundleOptions
                    : [];
            return (
              <div key={i} className="space-y-2 rounded-lg border bg-card p-3">
                <div className="flex items-center gap-2">
                  {item.itemType === "custom" ? (
                    <>
                      <Input
                        placeholder="Line description"
                        className="flex-1"
                        value={item.customName ?? ""}
                        onChange={(e) => patch(i, { customName: e.target.value })}
                      />
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="R"
                        className="w-24 tnum"
                        value={item.customPriceRands ?? ""}
                        onChange={(e) =>
                          patch(i, { customPriceRands: Number(e.target.value) || 0 })
                        }
                        aria-label="Price (R)"
                      />
                    </>
                  ) : (
                    <Select
                      value={
                        item.itemType === "plan"
                          ? (item.planId ?? undefined)
                          : item.itemType === "hardware"
                            ? (item.hardwareId ?? undefined)
                            : (item.bundleId ?? undefined)
                      }
                      onValueChange={(v) =>
                        patch(
                          i,
                          item.itemType === "plan"
                            ? { planId: v ?? undefined }
                            : item.itemType === "hardware"
                              ? { hardwareId: v ?? undefined }
                              : { bundleId: v ?? undefined }
                        )
                      }
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder={`Choose ${item.itemType}`} />
                      </SelectTrigger>
                      <SelectContent>
                        {options.map((o) => (
                          <SelectItem key={o.id} value={o.id}>
                            {o.name} — {formatR(o.priceCents)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => remove(i)}
                    aria-label="Remove line"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    Qty
                    <Input
                      type="number"
                      min="1"
                      className="w-16 tnum"
                      value={item.qty}
                      onChange={(e) =>
                        patch(i, { qty: Math.max(1, Number(e.target.value)) })
                      }
                    />
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    Discount (R)
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      className="w-24 tnum"
                      value={item.discountRands ?? ""}
                      onChange={(e) =>
                        patch(i, { discountRands: Number(e.target.value) || 0 })
                      }
                    />
                  </label>
                  <span className="ml-auto text-sm">
                    <span className="tnum font-mono font-medium">
                      {formatR(lineTotal)}
                    </span>
                    {lineMargin != null ? (
                      <span
                        className={`ml-2 text-xs ${lineMargin < 0 ? "text-red-600" : "text-muted-foreground"}`}
                      >
                        margin {formatR(lineMargin)}
                      </span>
                    ) : item.itemType !== "custom" ? (
                      <span className="ml-2 text-xs text-amber-700">
                        cost not set
                      </span>
                    ) : null}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {items.length > 0 ? (
        <>
          <div className="rounded-lg border bg-muted/40 p-3 text-sm">
            <div className="flex justify-between font-semibold">
              <span>Quote total</span>
              <span className="tnum font-mono">{formatR(totals.total)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Your visible margin</span>
              <span className="tnum font-mono">
                {totals.margin != null ? formatR(totals.margin) : "cost prices missing"}
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              disabled={pending}
              onClick={() => save(false)}
            >
              Save draft
            </Button>
            <Button className="flex-1" disabled={pending} onClick={() => save(true)}>
              {pending ? "Working…" : "Send quote"}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

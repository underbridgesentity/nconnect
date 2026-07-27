"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatCents } from "@/lib/money";
import { saveQuoteAction, type QuoteDraftItem } from "./actions";

export type Option = {
  id: string;
  name: string;
  /** "Telkom · 20 Mbps · Uncapped", shown under the name in the picker. */
  detail?: string | null;
  priceCents: number;
  costCents: number | null;
};

/** Percentage of an integer-cent amount, in basis points, rounded half-up. */
function percentOfCents(amount: number, percent: number): number {
  const basisPoints = Math.round(percent * 100);
  return Math.round((amount * basisPoints) / 10_000);
}

/** Rands typed into a number input to integer cents. */
function toCents(rands: number | undefined): number {
  return Math.round((rands ?? 0) * 100);
}

const DRAFT_KEY = "nc:quote-draft";

/**
 * Quote builder (spec §9.5): plans/bundles/hardware with quantities and
 * per-line discounts. Margin is visible to the rep (computed, not editable
 * cost). The §10.4 floor is checked here as the rep types so a breach never
 * arrives as a surprise after Send; the server remains the authority.
 */
export function QuoteBuilder({
  leadId,
  leadName,
  initialItems,
  draftScope,
  planOptions,
  hardwareOptions,
  bundleOptions,
  floorPercent,
  noCostMaxPercent,
}: {
  leadId?: string;
  leadName?: string;
  /** Lines copied from an existing quote when duplicating. */
  initialItems?: QuoteDraftItem[];
  /** Keeps a duplicate's autosave separate from a fresh quote's. */
  draftScope?: string;
  planOptions: Option[];
  hardwareOptions: Option[];
  bundleOptions: Option[];
  floorPercent: number;
  noCostMaxPercent: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [items, setItems] = useState<QuoteDraftItem[]>(initialItems ?? []);
  const [restored, setRestored] = useState(false);
  const undoRef = useRef<QuoteDraftItem[] | null>(null);

  const draftKey = `${DRAFT_KEY}:${draftScope ?? leadId ?? "none"}`;

  // A reload mid-call must not cost the rep the quote they just built. A
  // duplicate arrives with its lines already seeded, so it never restores.
  //
  // localStorage cannot be read during the server render, so the restore has
  // to happen once after mount. That is the documented exception to the
  // no-setState-in-effect rule: reading an external store on hydration.
  useEffect(() => {
    let restoredItems: QuoteDraftItem[] | null = null;
    if (!initialItems || initialItems.length === 0) {
      try {
        const saved = window.localStorage.getItem(draftKey);
        if (saved) {
          const parsed = JSON.parse(saved) as QuoteDraftItem[];
          if (Array.isArray(parsed) && parsed.length > 0) restoredItems = parsed;
        }
      } catch {
        // A corrupt draft is not worth an error, start clean.
      }
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (restoredItems) setItems(restoredItems);
    setRestored(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  useEffect(() => {
    if (!restored) return;
    try {
      if (items.length === 0) window.localStorage.removeItem(draftKey);
      else window.localStorage.setItem(draftKey, JSON.stringify(items));
    } catch {
      // Private browsing, storage full: the builder still works in memory.
    }
  }, [items, draftKey, restored]);

  const optionsFor = (itemType: QuoteDraftItem["itemType"]): Option[] =>
    itemType === "plan"
      ? planOptions
      : itemType === "hardware"
        ? hardwareOptions
        : itemType === "bundle"
          ? bundleOptions
          : [];

  const optionFor = (item: QuoteDraftItem): Option | null => {
    const id =
      item.itemType === "plan"
        ? item.planId
        : item.itemType === "hardware"
          ? item.hardwareId
          : item.itemType === "bundle"
            ? item.bundleId
            : null;
    if (!id) return null;
    return optionsFor(item.itemType).find((o) => o.id === id) ?? null;
  };

  /** The §10.4 floor, mirrored client-side. Empty string means the line is fine. */
  const floorBreach = (item: QuoteDraftItem, opt: Option | null): string => {
    const discount = toCents(item.discountRands);
    if (discount <= 0) return "";
    const price =
      item.itemType === "custom" ? toCents(item.customPriceRands) : (opt?.priceCents ?? 0);
    if (discount > price) return "The discount is bigger than the price.";
    const cost = item.itemType === "custom" ? null : (opt?.costCents ?? null);
    if (cost != null) {
      const floor = cost + percentOfCents(cost, floorPercent);
      if (price - discount < floor) {
        return `Below the floor: this line may not go under ${formatCents(floor)} (cost plus ${floorPercent}%).`;
      }
      return "";
    }
    const maxDiscount = percentOfCents(price, noCostMaxPercent);
    if (discount > maxDiscount) {
      return `No cost price is set, so the most you can take off is ${formatCents(maxDiscount)} (${noCostMaxPercent}%).`;
    }
    return "";
  };

  const totals = useMemo(() => {
    let total = 0;
    let cost = 0;
    let costKnown = true;
    let breaches = 0;
    let incomplete = 0;
    for (const item of items) {
      const opt = optionFor(item);
      if (item.itemType === "custom") {
        if (!item.customName?.trim() || toCents(item.customPriceRands) <= 0) incomplete++;
      } else if (!opt) {
        incomplete++;
      }
      const price =
        item.itemType === "custom" ? toCents(item.customPriceRands) : (opt?.priceCents ?? 0);
      const discount = toCents(item.discountRands);
      total += (price - discount) * item.qty;
      if (item.itemType === "custom") {
        // custom lines carry no cost
      } else if (opt?.costCents == null) {
        costKnown = false;
      } else {
        cost += opt.costCents * item.qty;
      }
      if (floorBreach(item, opt)) breaches++;
    }
    return { total, margin: costKnown ? total - cost : null, breaches, incomplete };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, planOptions, hardwareOptions, bundleOptions, floorPercent, noCostMaxPercent]);

  const blocked = totals.breaches > 0 || totals.incomplete > 0;

  const add = (itemType: QuoteDraftItem["itemType"]) =>
    setItems((prev) => [...prev, { itemType, qty: 1 }]);
  const patch = (i: number, p: Partial<QuoteDraftItem>) =>
    setItems((prev) => prev.map((item, idx) => (idx === i ? { ...item, ...p } : item)));
  const remove = (i: number) =>
    setItems((prev) => {
      undoRef.current = prev;
      const next = prev.filter((_, idx) => idx !== i);
      toast("Line removed", {
        action: {
          label: "Undo",
          onClick: () => {
            if (undoRef.current) setItems(undoRef.current);
          },
        },
      });
      return next;
    });

  const save = (send: boolean) =>
    startTransition(async () => {
      const r = await saveQuoteAction({ leadId, items, send });
      if (!r.ok) {
        toast.error(r.error ?? "Failed", { duration: 8000 });
        return;
      }
      try {
        window.localStorage.removeItem(draftKey);
      } catch {
        // nothing to clean up
      }
      if (!send) toast.success(r.message ?? "Draft saved");
      else if (r.delivered) toast.success(r.message ?? "Quote sent");
      else
        toast.warning(r.message ?? "Nothing was delivered", {
          duration: 15000,
          description: r.link,
        });
      router.push(r.quoteId ? `/sales/quotes/${r.quoteId}` : "/sales/quotes");
    });

  return (
    <div className="space-y-4">
      {leadName ? (
        <p className="rounded-2xl border bg-accent p-3 text-sm text-accent-foreground">
          Quoting <span className="font-semibold">{leadName}</span>
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className="touch-target px-5" onClick={() => add("plan")}>
          <Plus className="size-4" /> Plan
        </Button>
        <Button variant="outline" className="touch-target px-5" onClick={() => add("hardware")}>
          <Plus className="size-4" /> Hardware
        </Button>
        <Button variant="outline" className="touch-target px-5" onClick={() => add("bundle")}>
          <Plus className="size-4" /> Bundle
        </Button>
        <Button variant="outline" className="touch-target px-5" onClick={() => add("custom")}>
          <Plus className="size-4" /> Custom line
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          Add lines above. Discounts are allowed down to cost plus {floorPercent}%
          margin (or {noCostMaxPercent}% off where no cost price is set), deeper needs an admin.
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((item, i) => {
            const opt = optionFor(item);
            const price =
              item.itemType === "custom" ? toCents(item.customPriceRands) : (opt?.priceCents ?? 0);
            const discount = toCents(item.discountRands);
            const lineTotal = (price - discount) * item.qty;
            const lineMargin =
              item.itemType !== "custom" && opt?.costCents != null
                ? (price - discount - opt.costCents) * item.qty
                : null;
            const breach = floorBreach(item, opt);
            const breachId = `line-${i}-floor`;
            return (
              <div key={i} className="space-y-2 rounded-2xl border bg-card p-3">
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
                        className="tnum w-24"
                        value={item.customPriceRands ?? ""}
                        onChange={(e) =>
                          patch(i, { customPriceRands: Number(e.target.value) || 0 })
                        }
                        aria-label="Price (R)"
                      />
                    </>
                  ) : (
                    <ProductPicker
                      itemType={item.itemType}
                      options={optionsFor(item.itemType)}
                      selected={opt}
                      onSelect={(id) =>
                        patch(
                          i,
                          item.itemType === "plan"
                            ? { planId: id }
                            : item.itemType === "hardware"
                              ? { hardwareId: id }
                              : { bundleId: id }
                        )
                      }
                    />
                  )}
                  <Button
                    variant="ghost"
                    className="touch-target size-11 shrink-0 p-0"
                    onClick={() => remove(i)}
                    aria-label={`Remove line ${i + 1}`}
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
                      className="tnum w-16"
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
                      className="tnum w-24"
                      value={item.discountRands ?? ""}
                      aria-invalid={breach ? true : undefined}
                      aria-describedby={breach ? breachId : undefined}
                      onChange={(e) =>
                        patch(i, { discountRands: Number(e.target.value) || 0 })
                      }
                    />
                  </label>
                  <span className="ml-auto text-sm">
                    <span className="tnum font-medium">{formatCents(lineTotal)}</span>
                    {lineMargin != null ? (
                      <span
                        className={`tnum ml-2 text-xs ${lineMargin < 0 ? "text-destructive" : "text-muted-foreground"}`}
                      >
                        margin {formatCents(lineMargin)}
                      </span>
                    ) : item.itemType !== "custom" ? (
                      <span className="ml-2 text-xs text-amber-700">cost not set</span>
                    ) : null}
                  </span>
                </div>
                {breach ? (
                  <p id={breachId} role="alert" className="text-xs font-medium text-destructive">
                    {breach}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {items.length > 0 ? (
        <>
          <div className="rounded-2xl border bg-muted/40 p-3 text-sm">
            <div className="flex justify-between font-semibold">
              <span>Quote total</span>
              <span className="tnum">{formatCents(totals.total)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Your visible margin</span>
              <span className="tnum">
                {totals.margin != null ? formatCents(totals.margin) : "cost prices missing"}
              </span>
            </div>
          </div>
          {blocked ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {totals.breaches > 0
                ? `${totals.breaches} line${totals.breaches > 1 ? "s" : ""} breach the discount floor. Reduce the discount, or ask an admin to approve it.`
                : `Finish ${totals.incomplete} line${totals.incomplete > 1 ? "s" : ""} before sending.`}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="touch-target flex-1 px-5"
              disabled={pending || blocked}
              onClick={() => save(false)}
            >
              Save draft
            </Button>
            <Button
              className="touch-target flex-1 px-5"
              disabled={pending || blocked}
              onClick={() => save(true)}
            >
              {pending ? "Working…" : "Send quote"}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Type-to-search product picker: 26 published plans is too many to scroll. */
function ProductPicker({
  itemType,
  options,
  selected,
  onSelect,
}: {
  itemType: "plan" | "hardware" | "bundle";
  options: Option[];
  selected: Option | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="flex h-11 min-w-0 flex-1 items-center justify-between gap-2 rounded-full border bg-background px-4 text-left text-sm hover:bg-muted">
        <span className={selected ? "truncate" : "truncate text-muted-foreground"}>
          {selected ? `${selected.name}, ${formatCents(selected.priceCents)}` : `Choose ${itemType}`}
        </span>
        <ChevronDown className="size-4 shrink-0 opacity-60" aria-hidden />
      </PopoverTrigger>
      <PopoverContent className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <Command>
          <CommandInput placeholder={`Search ${itemType}s`} />
          <CommandList>
            <CommandEmpty>Nothing matches that.</CommandEmpty>
            {options.map((o) => (
              <CommandItem
                key={o.id}
                value={`${o.name} ${o.detail ?? ""}`}
                onSelect={() => {
                  onSelect(o.id);
                  setOpen(false);
                }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{o.name}</span>
                  {o.detail ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {o.detail}
                    </span>
                  ) : null}
                </span>
                <span className="tnum shrink-0 text-xs text-muted-foreground">
                  {formatCents(o.priceCents)}
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

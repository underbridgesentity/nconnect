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
import { EmptyState } from "@/components/shared/empty-state";
import { formatCents } from "@/lib/money";
import { saveQuoteAction } from "./actions";
import {
  MAX_QTY,
  priceLine,
  quoteTotals,
  readQty,
  type Option,
  type QuoteDraftItem,
} from "./pricing";

export type { Option, QuoteDraftItem };

// The draft shape changed when amounts stopped being rands in a float, so
// version the key: half-reading an old draft would drop its discounts.
const DRAFT_KEY = "nc:quote-draft/v2";

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

  // One priced line per draft line, in integer cents, from the module the save
  // action also uses. The rep and the server therefore never disagree about a
  // total, a margin or whether a line breaches the §10.4 floor.
  const lines = useMemo(
    () =>
      items.map((item) =>
        priceLine(item, optionFor(item), { floorPercent, noCostMaxPercent })
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, planOptions, hardwareOptions, bundleOptions, floorPercent, noCostMaxPercent]
  );
  const totals = useMemo(() => quoteTotals(lines), [lines]);

  const blocked = totals.problems > 0 || totals.incomplete > 0;

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
        <EmptyState
          title="Add lines above"
          description={`Discounts are allowed down to cost plus ${floorPercent}% margin (or ${noCostMaxPercent}% off where no cost price is set), deeper needs an admin.`}
        />
      ) : (
        <div className="space-y-2">
          {items.map((item, i) => {
            const opt = optionFor(item);
            const line = lines[i];
            // A custom line has no cost by nature, so it shows no margin at
            // all rather than a misleading R0.00.
            const lineMargin =
              item.itemType === "custom" ? null : line.marginCents;
            const problem = line.problem;
            const problemId = `line-${i}-problem`;
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
                      {/*
                        Text, not number: the amount is kept exactly as typed
                        and read into cents by `parseZar`, so "1 250,50" copied
                        off a supplier quote lands as 125050 and no rounding
                        happens on the way in.
                      */}
                      <Input
                        type="text"
                        inputMode="decimal"
                        placeholder="R"
                        className="tnum w-24"
                        value={item.customPrice ?? ""}
                        onChange={(e) => patch(i, { customPrice: e.target.value })}
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
                      max={MAX_QTY}
                      className="tnum w-16"
                      value={item.qty}
                      onChange={(e) => patch(i, { qty: readQty(e.target.value) })}
                    />
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    Discount (R)
                    <Input
                      type="text"
                      inputMode="decimal"
                      className="tnum w-24"
                      value={item.discount ?? ""}
                      aria-invalid={problem ? true : undefined}
                      aria-describedby={problem ? problemId : undefined}
                      onChange={(e) => patch(i, { discount: e.target.value })}
                    />
                  </label>
                  <span className="ml-auto text-sm">
                    <span className="tnum font-medium">
                      {formatCents(line.totalCents)}
                    </span>
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
                {problem ? (
                  <p id={problemId} role="alert" className="text-xs font-medium text-destructive">
                    {problem}
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
              <span className="tnum">{formatCents(totals.totalCents)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Your visible margin</span>
              <span className="tnum">
                {totals.marginCents != null
                  ? formatCents(totals.marginCents)
                  : "cost prices missing"}
              </span>
            </div>
          </div>
          {blocked ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {totals.problems > 0
                ? `${totals.problems} line${totals.problems > 1 ? "s" : ""} need${totals.problems > 1 ? "" : "s"} fixing before this can go out. See the notes above.`
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

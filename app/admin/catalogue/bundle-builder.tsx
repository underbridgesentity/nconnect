"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Pencil } from "lucide-react";
import { formatCents } from "@/lib/money";
import { saveBundleAction } from "./actions";
import {
  AMOUNT_HELP,
  bundleLine,
  bundleTotals,
  readQty,
  type BundleItemDraft,
  type BundleOption,
} from "./pricing";

export type BundleDraft = {
  id?: string;
  name: string;
  slug: string;
  description: string;
  /** The bundle price exactly as typed, never a float. */
  price: string;
  featured: boolean;
  validUntil?: string;
  items: BundleItemDraft[];
};

export function BundleBuilder({
  planOptions,
  hardwareOptions,
  existing,
}: {
  planOptions: BundleOption[];
  hardwareOptions: BundleOption[];
  existing?: BundleDraft;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<BundleDraft>(
    existing ?? {
      name: "",
      slug: "",
      description: "",
      price: "",
      featured: false,
      items: [],
    }
  );

  // Every figure below, and every figure the save writes, comes out of the
  // same helpers in integer cents, so the margin on screen is the margin the
  // catalogue gets.
  const { lines, totals } = useMemo(() => {
    const priced = draft.items.map((item, index) => {
      const option =
        item.itemType === "plan"
          ? (planOptions.find((p) => p.id === item.planId) ?? null)
          : item.itemType === "hardware"
            ? (hardwareOptions.find((h) => h.id === item.hardwareId) ?? null)
            : null;
      return bundleLine(item, option, index + 1);
    });
    return { lines: priced, totals: bundleTotals(priced, draft.price) };
  }, [draft, planOptions, hardwareOptions]);

  // An empty price field is not yet a mistake, it is a field nobody has filled
  // in. Only text that is there and cannot be read gets the red treatment.
  const priceUnreadable = draft.price.trim() !== "" && totals.priceCents == null;

  const addItem = (itemType: BundleItemDraft["itemType"]) => {
    setDraft((d) => ({
      ...d,
      items: [...d.items, { itemType, qty: 1 }],
    }));
  };

  const updateItem = (index: number, patch: Partial<BundleItemDraft>) => {
    setDraft((d) => ({
      ...d,
      items: d.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }));
  };

  const removeItem = (index: number) => {
    setDraft((d) => ({ ...d, items: d.items.filter((_, i) => i !== index) }));
  };

  const save = () => {
    // The server refuses an unreadable amount too. Saying so here, naming the
    // line, means the admin fixes it in front of the field rather than reading
    // it back off a toast.
    if (totals.problems.length > 0) {
      toast.error(totals.problems[0]);
      return;
    }
    startTransition(async () => {
      const result = await saveBundleAction({
        id: draft.id,
        name: draft.name,
        slug: draft.slug,
        description: draft.description,
        price: draft.price,
        featured: draft.featured,
        validUntil: draft.validUntil,
        items: draft.items,
      });
      if (result.ok) {
        toast.success("Bundle saved");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error ?? "Failed");
      }
    });
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          existing ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Edit ${existing.name}`}
            >
              <Pencil className="size-4" />
            </Button>
          ) : (
            <Button size="sm">
              <Plus className="size-4" /> New bundle
            </Button>
          )
        }
      />
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{existing ? `Edit ${existing.name}` : "New bundle"}</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-8">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Slug</Label>
              <Input
                value={draft.slug}
                pattern="[a-z0-9-]+"
                onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea
              rows={2}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Items</Label>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" onClick={() => addItem("plan")}>
                  + Plan
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => addItem("hardware")}
                >
                  + Hardware
                </Button>
                <Button variant="outline" size="sm" onClick={() => addItem("custom")}>
                  + Custom
                </Button>
              </div>
            </div>
            {draft.items.length === 0 ? (
              <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                Add at least one plan, hardware item or custom line.
              </p>
            ) : null}
            {draft.items.map((item, i) => (
              <div key={i} className="space-y-1">
                <div className="flex items-center gap-2 rounded-md border p-2">
                  {item.itemType === "plan" ? (
                    <Select
                      value={item.planId ?? undefined}
                      onValueChange={(v) => updateItem(i, { planId: v ?? undefined })}
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Choose plan" />
                      </SelectTrigger>
                      <SelectContent>
                        {planOptions.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}, {formatCents(p.priceCents)}/mo
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : item.itemType === "hardware" ? (
                    <Select
                      value={item.hardwareId ?? undefined}
                      onValueChange={(v) =>
                        updateItem(i, { hardwareId: v ?? undefined })
                      }
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Choose hardware" />
                      </SelectTrigger>
                      <SelectContent>
                        {hardwareOptions.map((h) => (
                          <SelectItem key={h.id} value={h.id}>
                            {h.name}, {formatCents(h.priceCents)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <>
                      <Input
                        placeholder="Line name (e.g. Free delivery)"
                        className="flex-1"
                        value={item.customName ?? ""}
                        onChange={(e) => updateItem(i, { customName: e.target.value })}
                      />
                      {/*
                        Text, not a number field: a number field silently blanks
                        anything it dislikes, so "R1 250,50" pasted off this
                        app's own screens arrived as nothing and saved as zero.
                        The typed text is kept exactly and read by parseZar.
                      */}
                      <Input
                        inputMode="decimal"
                        placeholder="R"
                        className="tnum w-24"
                        aria-label={`Price for line ${i + 1}`}
                        aria-invalid={lines[i]?.problem ? true : undefined}
                        value={item.customPrice ?? ""}
                        onChange={(e) =>
                          updateItem(i, { customPrice: e.target.value })
                        }
                      />
                    </>
                  )}
                  {/*
                    Still a number field: a quantity is a count, not money, so
                    nothing here needs parseZar. It goes through `readQty` only
                    because a cleared field hands back "", and `Number("")`
                    reaching multiply() used to print the totals as "RNaN".
                  */}
                  <Input
                    type="number"
                    min="1"
                    className="tnum w-16"
                    value={item.qty}
                    onChange={(e) =>
                      updateItem(i, { qty: readQty(e.target.value) })
                    }
                    aria-label="Quantity"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeItem(i)}
                    aria-label="Remove line"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                {lines[i]?.problem ? (
                  <p className="px-1 text-xs font-medium text-destructive">
                    {lines[i].problem}
                  </p>
                ) : null}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="bundle-price">
                Bundle price (R/month equivalent)
              </Label>
              <Input
                id="bundle-price"
                inputMode="decimal"
                className="tnum"
                placeholder="1 250,50"
                aria-invalid={priceUnreadable ? true : undefined}
                value={draft.price}
                onChange={(e) => setDraft({ ...draft, price: e.target.value })}
              />
              {priceUnreadable ? (
                <p className="text-xs font-medium text-destructive">
                  {AMOUNT_HELP}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bundle-valid-until">Valid until (optional)</Label>
              <Input
                id="bundle-valid-until"
                type="date"
                value={draft.validUntil ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, validUntil: e.target.value || undefined })
                }
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={draft.featured}
              onCheckedChange={(v) => setDraft({ ...draft, featured: v === true })}
            />
            Featured (&ldquo;Grab this deal&rdquo; on the home page)
          </label>

          {/* Live margin readout (spec §9.4.3) */}
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <div className="flex justify-between">
              <span>Component prices add up to</span>
              <span className="tnum">
                {formatCents(totals.componentPriceCents)}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Known wholesale cost</span>
              <span className="tnum">{formatCents(totals.knownCostCents)}</span>
            </div>
            <div className="mt-1 flex justify-between border-t pt-1 font-medium">
              <span>Margin at bundle price</span>
              <span className="tnum">
                {totals.marginCents == null
                  ? totals.costMissing
                    ? "cost price missing"
                    : "enter a bundle price"
                  : formatCents(totals.marginCents)}
              </span>
            </div>
          </div>

          <Button
            onClick={save}
            disabled={
              pending ||
              !draft.name ||
              !draft.slug ||
              draft.items.length === 0 ||
              totals.problems.length > 0
            }
            className="w-full"
          >
            {pending ? "Saving…" : "Save bundle"}
          </Button>
          {totals.problems.length > 0 ? (
            <p className="text-xs font-medium text-destructive">
              {totals.problems[0]}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            New bundles save as drafts. Publish from the list once reviewed.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

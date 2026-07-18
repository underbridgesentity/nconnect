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
import { saveBundleAction, type BundleItemDraft } from "./actions";

type Option = { id: string; name: string; priceCents: number; costCents: number | null };

export type BundleDraft = {
  id?: string;
  name: string;
  slug: string;
  description: string;
  priceRands: number;
  featured: boolean;
  validUntil?: string;
  items: BundleItemDraft[];
};

function formatR(cents: number) {
  return `R${(cents / 100).toFixed(2)}`;
}

export function BundleBuilder({
  planOptions,
  hardwareOptions,
  existing,
}: {
  planOptions: Option[];
  hardwareOptions: Option[];
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
      priceRands: 0,
      featured: false,
      items: [],
    }
  );

  const totals = useMemo(() => {
    let componentPrice = 0;
    let cost = 0;
    let costMissing = false;
    for (const item of draft.items) {
      const source =
        item.itemType === "plan"
          ? planOptions.find((p) => p.id === item.planId)
          : item.itemType === "hardware"
            ? hardwareOptions.find((h) => h.id === item.hardwareId)
            : null;
      if (item.itemType === "custom") {
        componentPrice += (item.customPriceRands ?? 0) * 100 * item.qty;
      } else if (source) {
        componentPrice += source.priceCents * item.qty;
        if (source.costCents == null) costMissing = true;
        else cost += source.costCents * item.qty;
      }
    }
    const bundlePriceCents = Math.round(draft.priceRands * 100);
    return {
      componentPrice,
      cost,
      costMissing,
      margin: costMissing ? null : bundlePriceCents - cost,
    };
  }, [draft, planOptions, hardwareOptions]);

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
    startTransition(async () => {
      const result = await saveBundleAction({
        id: draft.id,
        name: draft.name,
        slug: draft.slug,
        description: draft.description,
        priceRands: draft.priceRands,
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
              <div key={i} className="flex items-center gap-2 rounded-md border p-2">
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
                          {p.name} — {formatR(p.priceCents)}/mo
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : item.itemType === "hardware" ? (
                  <Select
                    value={item.hardwareId ?? undefined}
                    onValueChange={(v) => updateItem(i, { hardwareId: v ?? undefined })}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Choose hardware" />
                    </SelectTrigger>
                    <SelectContent>
                      {hardwareOptions.map((h) => (
                        <SelectItem key={h.id} value={h.id}>
                          {h.name} — {formatR(h.priceCents)}
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
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="R"
                      className="w-24 tnum"
                      value={item.customPriceRands ?? ""}
                      onChange={(e) =>
                        updateItem(i, {
                          customPriceRands:
                            e.target.value === "" ? 0 : Number(e.target.value),
                        })
                      }
                    />
                  </>
                )}
                <Input
                  type="number"
                  min="1"
                  className="w-16 tnum"
                  value={item.qty}
                  onChange={(e) =>
                    updateItem(i, { qty: Math.max(1, Number(e.target.value)) })
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
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Bundle price (R/month equivalent)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                className="tnum"
                value={draft.priceRands || ""}
                onChange={(e) =>
                  setDraft({ ...draft, priceRands: Number(e.target.value) || 0 })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Valid until (optional)</Label>
              <Input
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
              <span className="tnum font-mono">{formatR(totals.componentPrice)}</span>
            </div>
            <div className="flex justify-between">
              <span>Known wholesale cost</span>
              <span className="tnum font-mono">{formatR(totals.cost)}</span>
            </div>
            <div className="mt-1 flex justify-between border-t pt-1 font-medium">
              <span>Margin at bundle price</span>
              <span className="tnum font-mono">
                {totals.margin == null ? "cost price missing" : formatR(totals.margin)}
              </span>
            </div>
          </div>

          <Button
            onClick={save}
            disabled={
              pending || !draft.name || !draft.slug || draft.items.length === 0
            }
            className="w-full"
          >
            {pending ? "Saving…" : "Save bundle"}
          </Button>
          <p className="text-xs text-muted-foreground">
            New bundles save as drafts. Publish from the list once reviewed.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

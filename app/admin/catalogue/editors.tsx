"use client";

import { useState, useTransition } from "react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MoreHorizontal, Pencil, Plus } from "lucide-react";
import { FilterPillButton } from "@/components/ui/filter-pill";
import {
  savePlanAction,
  saveHardwareAction,
  setPlanStatusAction,
  setHardwareStatusAction,
  setBundleStatusAction,
  saveCostPricesAction,
  type ActionResult,
} from "./actions";

/**
 * The slug is the plan's public URL. Rewriting it on a published plan 404s
 * /plans/[slug] and every quote, email and marketing link pointing at it,
 * so on a live record it takes a deliberate unlock first.
 */
function SlugField({ slug, published }: { slug: string; published: boolean }) {
  const [unlocked, setUnlocked] = useState(!published);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="slug">Slug (public URL)</Label>
        {published ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setUnlocked((v) => !v)}
            aria-pressed={unlocked}
          >
            {unlocked ? "Lock" : "Change public URL"}
          </Button>
        ) : null}
      </div>
      <Input
        id="slug"
        name="slug"
        defaultValue={slug}
        required
        pattern="[a-z0-9-]+"
        readOnly={!unlocked}
        aria-describedby={published ? "slug-warning" : undefined}
        className={!unlocked ? "bg-muted text-muted-foreground" : undefined}
      />
      {published ? (
        <p id="slug-warning" className="text-xs text-muted-foreground">
          {unlocked
            ? `Changing this breaks every existing link to /plans/${slug}.`
            : `Live at /plans/${slug}.`}
        </p>
      ) : null}
    </div>
  );
}

/** Serializable shapes passed from the server page. */
export type PlanRow = {
  id: string;
  providerId: string;
  category: string;
  name: string;
  slug: string;
  description: string | null;
  speedDownMbps: number | null;
  speedUpMbps: number | null;
  dataAllocation: string | null;
  fupDetail: string | null;
  contractMonths: number | null;
  priceCents: number;
  costCents: number | null;
  onceOffCents: number;
  onceOffCostCents: number | null;
  status: string;
  featured: boolean;
  sortOrder: number;
  providerName: string;
};

export type HardwareRow = {
  id: string;
  sku: string;
  name: string;
  category: string;
  description: string | null;
  priceCents: number;
  costCents: number | null;
  stockQty: number;
  lowStockThreshold: number;
  status: string;
  imagePath: string | null;
  imageUrl: string | null;
  sortOrder: number;
};

import { PLAN_CATEGORIES, HW_CATEGORIES } from "./constants";

function useActionRunner() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<ActionResult>, onDone?: () => void) => {
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        toast.success("Saved");
        router.refresh();
        onDone?.();
      } else {
        toast.error(result.error ?? "Failed");
      }
    });
  };
  return { pending, run };
}

function MoneyField({
  name,
  label,
  defaultCents,
  required = false,
  placeholder,
}: {
  name: string;
  label: string;
  defaultCents: number | null;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type="number"
        step="0.01"
        min="0"
        required={required}
        placeholder={placeholder}
        defaultValue={defaultCents != null ? (defaultCents / 100).toString() : ""}
        className="tnum"
      />
    </div>
  );
}

export function PlanEditor({
  plan,
  providers,
  trigger,
}: {
  plan: PlanRow | null;
  providers: { id: string; name: string }[];
  trigger?: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useActionRunner();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          trigger ?? (
            <Button variant="ghost" size="icon" aria-label={`Edit ${plan?.name}`}>
              <Pencil className="size-4" />
            </Button>
          )
        }
      />
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{plan ? `Edit ${plan.name}` : "New plan"}</SheetTitle>
        </SheetHeader>
        <form
          className="space-y-4 px-4 pb-8"
          action={(form) => run(() => savePlanAction(form), () => setOpen(false))}
        >
          {plan ? <input type="hidden" name="id" value={plan.id} /> : null}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Provider</Label>
              <Select name="providerId" defaultValue={plan?.providerId} required>
                <SelectTrigger>
                  <SelectValue placeholder="Choose" />
                </SelectTrigger>
                <SelectContent>
                  {providers.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select name="category" defaultValue={plan?.category} required>
                <SelectTrigger>
                  <SelectValue placeholder="Choose" />
                </SelectTrigger>
                <SelectContent>
                  {PLAN_CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" defaultValue={plan?.name} required />
          </div>
          <SlugField
            slug={plan?.slug ?? ""}
            published={plan?.status === "published"}
          />
          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              name="description"
              rows={2}
              defaultValue={plan?.description ?? ""}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <MoneyField
              name="priceRands"
              label="Monthly price (R)"
              defaultCents={plan?.priceCents ?? null}
              required
            />
            <MoneyField
              name="costRands"
              label="Monthly cost (R, wholesale)"
              defaultCents={plan?.costCents ?? null}
              placeholder="not set"
            />
            <MoneyField
              name="onceOffRands"
              label="Once-off (R)"
              defaultCents={plan?.onceOffCents ?? 0}
            />
            <MoneyField
              name="onceOffCostRands"
              label="Once-off cost (R)"
              defaultCents={plan?.onceOffCostCents ?? null}
              placeholder="not set"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="speedDownMbps">Down Mbps</Label>
              <Input
                id="speedDownMbps"
                name="speedDownMbps"
                type="number"
                defaultValue={plan?.speedDownMbps ?? ""}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="speedUpMbps">Up Mbps</Label>
              <Input
                id="speedUpMbps"
                name="speedUpMbps"
                type="number"
                defaultValue={plan?.speedUpMbps ?? ""}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contractMonths">Contract (months)</Label>
              <Input
                id="contractMonths"
                name="contractMonths"
                type="number"
                defaultValue={plan?.contractMonths ?? ""}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dataAllocation">Data allocation</Label>
            <Input
              id="dataAllocation"
              name="dataAllocation"
              defaultValue={plan?.dataAllocation ?? ""}
              placeholder="e.g. 150GB @ full speed, then 512Kbps"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fupDetail">FUP detail (plain language)</Label>
            <Textarea
              id="fupDetail"
              name="fupDetail"
              rows={2}
              defaultValue={plan?.fupDetail ?? ""}
            />
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox name="featured" defaultChecked={plan?.featured} />
              Featured
            </label>
            <div className="flex items-center gap-2">
              <Label htmlFor="sortOrder" className="text-sm">
                Sort
              </Label>
              <Input
                id="sortOrder"
                name="sortOrder"
                type="number"
                defaultValue={plan?.sortOrder ?? 0}
                className="w-20"
              />
            </div>
          </div>
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Saving…" : "Save plan"}
          </Button>
          <p className="text-xs text-muted-foreground">
            New plans save as drafts. Publish from the table once reviewed.
          </p>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export function HardwareEditor({
  hardware,
  trigger,
}: {
  hardware: HardwareRow | null;
  trigger?: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useActionRunner();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          trigger ?? (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Edit ${hardware?.name}`}
            >
              <Pencil className="size-4" />
            </Button>
          )
        }
      />
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>
            {hardware ? `Edit ${hardware.name}` : "New hardware"}
          </SheetTitle>
        </SheetHeader>
        <form
          className="space-y-4 px-4 pb-8"
          action={(form) =>
            run(() => saveHardwareAction(form), () => setOpen(false))
          }
        >
          {hardware ? <input type="hidden" name="id" value={hardware.id} /> : null}
          <input
            type="hidden"
            name="existingImagePath"
            value={hardware?.imagePath ?? ""}
          />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sku">SKU</Label>
              <Input id="sku" name="sku" defaultValue={hardware?.sku} required />
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select name="category" defaultValue={hardware?.category} required>
                <SelectTrigger>
                  <SelectValue placeholder="Choose" />
                </SelectTrigger>
                <SelectContent>
                  {HW_CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hw-name">Name</Label>
            <Input id="hw-name" name="name" defaultValue={hardware?.name} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hw-description">Key features</Label>
            <Textarea
              id="hw-description"
              name="description"
              rows={2}
              defaultValue={hardware?.description ?? ""}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <MoneyField
              name="priceRands"
              label="Price (R)"
              defaultCents={hardware?.priceCents ?? null}
              required
            />
            <MoneyField
              name="costRands"
              label="Cost (R, wholesale)"
              defaultCents={hardware?.costCents ?? null}
              placeholder="not set"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="stockQty">Stock</Label>
              <Input
                id="stockQty"
                name="stockQty"
                type="number"
                min="0"
                defaultValue={hardware?.stockQty ?? 0}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lowStockThreshold">Low-stock at</Label>
              <Input
                id="lowStockThreshold"
                name="lowStockThreshold"
                type="number"
                min="0"
                defaultValue={hardware?.lowStockThreshold ?? 3}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hw-sortOrder">Sort</Label>
              <Input
                id="hw-sortOrder"
                name="sortOrder"
                type="number"
                defaultValue={hardware?.sortOrder ?? 0}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="image">Product image (min 800px wide, becomes webp)</Label>
            <Input id="image" name="image" type="file" accept="image/*" />
            {hardware?.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- signed/dev URLs are not static imports
              <img
                src={hardware.imageUrl}
                alt={hardware.name}
                className="mt-2 h-24 w-24 rounded-md border object-contain"
              />
            ) : null}
          </div>
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Saving…" : "Save hardware"}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Publish, unpublish and archive used to fire straight off the dropdown.
 * Taking a live product off the public site is not an undoable menu click,
 * so unpublish and archive now say what happens, and how many customers are
 * still being billed on the record, before they run.
 */
export function StatusMenu({
  kind,
  id,
  status,
  name,
  activeServices = 0,
}: {
  kind: "plan" | "hardware" | "bundle";
  id: string;
  status: string;
  name: string;
  /** Live services still billing on this record, plans only. */
  activeServices?: number;
}) {
  const { pending, run } = useActionRunner();
  const [confirming, setConfirming] = useState<"draft" | "archived" | null>(null);

  const setStatus = (next: "draft" | "published" | "archived") => {
    const fn =
      kind === "plan"
        ? () => setPlanStatusAction(id, next)
        : kind === "hardware"
          ? () => setHardwareStatusAction(id, next)
          : () => setBundleStatusAction(id, next);
    run(fn);
    setConfirming(null);
  };

  const noun = kind === "plan" ? "plan" : kind === "hardware" ? "product" : "bundle";
  const stillBilling =
    activeServices > 0
      ? ` ${activeServices} active service${activeServices === 1 ? "" : "s"} keep billing on it, nothing changes for those customers.`
      : "";
  const consequence =
    confirming === "archived"
      ? `Archiving removes ${name} from the public site, signup and every quote immediately, and it stops appearing in the catalogue PDF.${stillBilling}`
      : `Unpublishing takes ${name} off the public site and out of signup right away. Links from live quotes and marketing will stop working.${stillBilling}`;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              disabled={pending}
              aria-label={`Change status of ${name}`}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          {status !== "published" ? (
            <DropdownMenuItem onClick={() => setStatus("published")}>
              Publish
            </DropdownMenuItem>
          ) : null}
          {status !== "draft" ? (
            <DropdownMenuItem
              onClick={() =>
                status === "published" ? setConfirming("draft") : setStatus("draft")
              }
            >
              Unpublish (draft){status === "published" ? "…" : ""}
            </DropdownMenuItem>
          ) : null}
          {status !== "archived" ? (
            <DropdownMenuItem onClick={() => setConfirming("archived")}>
              Archive…
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={confirming !== null}
        onOpenChange={(open) => (open ? null : setConfirming(null))}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {confirming === "archived" ? "Archive" : "Unpublish"} this {noun}?
            </DialogTitle>
            <DialogDescription>{consequence}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(null)}>
              Leave it published
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => confirming && setStatus(confirming)}
            >
              {confirming === "archived" ? "Archive" : "Unpublish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function NewPlanButton({
  providers,
}: {
  providers: { id: string; name: string }[];
}) {
  return (
    <PlanEditor
      plan={null}
      providers={providers}
      trigger={
        <Button size="sm">
          <Plus className="size-4" /> New plan
        </Button>
      }
    />
  );
}

export function NewHardwareButton() {
  return (
    <HardwareEditor
      hardware={null}
      trigger={
        <Button size="sm">
          <Plus className="size-4" /> New hardware
        </Button>
      }
    />
  );
}

export type CostRow = {
  kind: "plan" | "hardware";
  id: string;
  name: string;
  group: string;
  priceCents: number;
  costCents: number | null;
};

/**
 * Every plan and SKU on one screen with an inline cost input and a single
 * Save. Filling wholesale costs in through the per-record sheet is 46 open,
 * scroll, type, save, wait cycles, and margin reporting is blind until it
 * is done.
 */
export function CostPriceTable({ rows }: { rows: CostRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [missingOnly, setMissingOnly] = useState(
    rows.some((r) => r.costCents == null)
  );
  const missingCount = rows.filter((r) => r.costCents == null).length;
  const visible = missingOnly ? rows.filter((r) => r.costCents == null) : rows;

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        Nothing in the catalogue yet.
      </p>
    );
  }

  return (
    <form
      className="space-y-3"
      action={(form) =>
        startTransition(async () => {
          const result = await saveCostPricesAction(form);
          if (!result.ok) {
            toast.error(result.error ?? "Failed");
            return;
          }
          toast.success(
            result.saved
              ? `${result.saved} cost price${result.saved === 1 ? "" : "s"} saved`
              : "Nothing changed"
          );
          router.refresh();
        })
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        {[
          [true, `Missing cost (${missingCount})`],
          [false, `Everything (${rows.length})`],
        ].map(([value, label]) => (
          <FilterPillButton
            key={String(label)}
            onClick={() => setMissingOnly(Boolean(value))}
            active={missingOnly === value}
          >
            {String(label)}
          </FilterPillButton>
        ))}
        <Button type="submit" size="sm" disabled={pending} className="ml-auto">
          {pending ? "Saving…" : "Save all cost prices"}
        </Button>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          Every plan and product has a wholesale cost. Margin reporting is
          complete.
        </p>
      ) : (
        <div className="max-h-[70vh] overflow-auto rounded-lg border bg-card">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="sticky top-0 z-10 border-b bg-card text-left text-xs text-muted-foreground">
                <th className="p-3 font-medium">Item</th>
                <th className="p-3 font-medium">Group</th>
                <th className="p-3 text-right font-medium">Sell</th>
                <th className="p-3 text-right font-medium">Cost (R)</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={`${row.kind}:${row.id}`} className="border-b last:border-0">
                  <td className="p-3 font-medium">{row.name}</td>
                  <td className="p-3 text-muted-foreground">{row.group}</td>
                  <td className="tnum p-3 text-right">
                    {(row.priceCents / 100).toFixed(2)}
                  </td>
                  <td className="p-3 text-right">
                    <Input
                      name={`cost:${row.kind}:${row.id}`}
                      inputMode="decimal"
                      defaultValue={
                        row.costCents != null
                          ? (row.costCents / 100).toFixed(2)
                          : ""
                      }
                      placeholder="not set"
                      aria-label={`Wholesale cost for ${row.name}`}
                      className="tnum ml-auto w-28 text-right"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Cost is what the provider charges Needd. Leave a field blank to keep it
        unknown; margin then shows as &ldquo;cost missing&rdquo; rather than
        guessing.
      </p>
    </form>
  );
}

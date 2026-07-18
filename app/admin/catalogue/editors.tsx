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
import { MoreHorizontal, Pencil, Plus } from "lucide-react";
import {
  savePlanAction,
  saveHardwareAction,
  setPlanStatusAction,
  setHardwareStatusAction,
  setBundleStatusAction,
  type ActionResult,
} from "./actions";

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
          <div className="space-y-1.5">
            <Label htmlFor="slug">Slug</Label>
            <Input
              id="slug"
              name="slug"
              defaultValue={plan?.slug}
              required
              pattern="[a-z0-9-]+"
            />
          </div>
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

export function StatusMenu({
  kind,
  id,
  status,
}: {
  kind: "plan" | "hardware" | "bundle";
  id: string;
  status: string;
}) {
  const { pending, run } = useActionRunner();
  const setStatus = (next: "draft" | "published" | "archived") => {
    const fn =
      kind === "plan"
        ? () => setPlanStatusAction(id, next)
        : kind === "hardware"
          ? () => setHardwareStatusAction(id, next)
          : () => setBundleStatusAction(id, next);
    run(fn);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            disabled={pending}
            aria-label="Change status"
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
          <DropdownMenuItem onClick={() => setStatus("draft")}>
            Unpublish (draft)
          </DropdownMenuItem>
        ) : null}
        {status !== "archived" ? (
          <DropdownMenuItem onClick={() => setStatus("archived")}>
            Archive
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
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

import { cn } from "@/lib/utils";

/**
 * StatusPill (spec §11): the same component everywhere a status appears.
 * Never colour-only, the label always renders.
 */

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  // service lifecycle
  pending: { label: "Pending", className: "bg-amber-50 text-amber-700 border-amber-200" },
  provisioning: { label: "Being activated", className: "bg-blue-50 text-blue-700 border-blue-200" },
  active: { label: "Active", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  suspended: { label: "Suspended", className: "bg-amber-50 text-amber-800 border-amber-300" },
  pending_cancellation: { label: "Cancelling", className: "bg-zinc-100 text-zinc-600 border-zinc-200" },
  cancelled: { label: "Cancelled", className: "bg-zinc-100 text-zinc-500 border-zinc-200" },
  // invoices
  draft: { label: "Draft", className: "bg-zinc-100 text-zinc-600 border-zinc-200" },
  open: { label: "Open", className: "bg-blue-50 text-blue-700 border-blue-200" },
  paid: { label: "Paid", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  past_due: { label: "Past due", className: "bg-red-50 text-red-700 border-red-200" },
  void: { label: "Void", className: "bg-zinc-100 text-zinc-500 border-zinc-200" },
  written_off: { label: "Written off", className: "bg-zinc-100 text-zinc-500 border-zinc-200" },
  // orders
  pending_payment: { label: "Awaiting payment", className: "bg-amber-50 text-amber-700 border-amber-200" },
  processing: { label: "Processing", className: "bg-blue-50 text-blue-700 border-blue-200" },
  fulfilled: { label: "Fulfilled", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  // catalogue
  published: { label: "Published", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  archived: { label: "Archived", className: "bg-zinc-100 text-zinc-500 border-zinc-200" },
  // conversations
  resolved: { label: "Resolved", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  // leads
  new: { label: "New", className: "bg-blue-50 text-blue-700 border-blue-200" },
  contacted: { label: "Contacted", className: "bg-amber-50 text-amber-700 border-amber-200" },
  quoted: { label: "Quoted", className: "bg-violet-50 text-violet-700 border-violet-200" },
  won: { label: "Won", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  lost: { label: "Lost", className: "bg-zinc-100 text-zinc-500 border-zinc-200" },
  // quotes
  sent: { label: "Sent", className: "bg-blue-50 text-blue-700 border-blue-200" },
  viewed: { label: "Viewed", className: "bg-violet-50 text-violet-700 border-violet-200" },
  accepted: { label: "Accepted", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  expired: { label: "Expired", className: "bg-zinc-100 text-zinc-500 border-zinc-200" },
  // rica / tasks
  verified: { label: "Verified", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  rejected: { label: "Rejected", className: "bg-red-50 text-red-700 border-red-200" },
  in_progress: { label: "In progress", className: "bg-blue-50 text-blue-700 border-blue-200" },
  blocked: { label: "Blocked", className: "bg-red-50 text-red-700 border-red-200" },
  done: { label: "Done", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
};

export function StatusPill({
  status,
  labelOverride,
  className,
}: {
  status: string;
  labelOverride?: string;
  className?: string;
}) {
  const style = STATUS_STYLES[status] ?? {
    label: status,
    className: "bg-zinc-100 text-zinc-600 border-zinc-200",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        style.className,
        className
      )}
    >
      {labelOverride ?? style.label}
    </span>
  );
}

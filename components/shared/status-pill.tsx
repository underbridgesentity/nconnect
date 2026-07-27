import { cn } from "@/lib/utils";

/**
 * StatusPill (spec §11): the same component everywhere a status appears.
 * Never colour-only, the label always renders.
 *
 * Every pairing below clears 4.5:1 against its own background at 12px, which
 * is the bar these pills have to meet because the label is text-xs. The muted
 * terminal states use zinc-600 rather than zinc-500: zinc-500 on zinc-100 only
 * reaches 4.40:1 and fails AA.
 */

const MUTED = "bg-zinc-100 text-zinc-600 border-zinc-200";

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  // service lifecycle
  pending: { label: "Pending", className: "bg-amber-50 text-amber-700 border-amber-200" },
  provisioning: { label: "Being activated", className: "bg-blue-50 text-blue-700 border-blue-200" },
  active: { label: "Active", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  suspended: { label: "Suspended", className: "bg-amber-50 text-amber-800 border-amber-300" },
  pending_cancellation: { label: "Cancelling", className: MUTED },
  cancelled: { label: "Cancelled", className: MUTED },
  // invoices
  draft: { label: "Draft", className: MUTED },
  open: { label: "Open", className: "bg-blue-50 text-blue-700 border-blue-200" },
  paid: { label: "Paid", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  past_due: { label: "Past due", className: "bg-red-50 text-red-700 border-red-200" },
  void: { label: "Void", className: MUTED },
  written_off: { label: "Written off", className: MUTED },
  // orders
  pending_payment: { label: "Awaiting payment", className: "bg-amber-50 text-amber-700 border-amber-200" },
  processing: { label: "Processing", className: "bg-blue-50 text-blue-700 border-blue-200" },
  fulfilled: { label: "Fulfilled", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  // catalogue
  published: { label: "Published", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  archived: { label: "Archived", className: MUTED },
  // conversations
  resolved: { label: "Resolved", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  // leads
  new: { label: "New", className: "bg-blue-50 text-blue-700 border-blue-200" },
  contacted: { label: "Contacted", className: "bg-amber-50 text-amber-700 border-amber-200" },
  quoted: { label: "Quoted", className: "bg-violet-50 text-violet-700 border-violet-200" },
  won: { label: "Won", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  lost: { label: "Lost", className: MUTED },
  // quotes
  sent: { label: "Sent", className: "bg-blue-50 text-blue-700 border-blue-200" },
  viewed: { label: "Viewed", className: "bg-violet-50 text-violet-700 border-violet-200" },
  accepted: { label: "Accepted", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  expired: { label: "Expired", className: MUTED },
  // rica / tasks
  verified: { label: "Verified", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  rejected: { label: "Rejected", className: "bg-red-50 text-red-700 border-red-200" },
  in_progress: { label: "In progress", className: "bg-blue-50 text-blue-700 border-blue-200" },
  blocked: { label: "Blocked", className: "bg-red-50 text-red-700 border-red-200" },
  done: { label: "Done", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
};

/** Turns an unmapped database enum such as `pending_review` into "Pending review". */
function humanise(status: string) {
  const words = status.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : status;
}

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
    label: humanise(status),
    className: MUTED,
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

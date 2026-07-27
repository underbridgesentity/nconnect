import { formatDate } from "@/lib/format";
import { addDays } from "./dates";

/**
 * What to say about an unpaid invoice.
 *
 * Suspension is the cheapest collections lever there is, and it is currently
 * a surprise: the dunning sweep suspends at issue date + suspendDay, but only
 * for an invoice tied to a service. Say the date when it applies, and say
 * nothing about suspension when it does not.
 */
export function outstandingLine(params: {
  number: string;
  status: string;
  issueDate: string;
  dueDate: string;
  /** Invoices with no service (a once-off order) never trigger a suspension. */
  hasService: boolean;
  suspendDay: number;
  today: string;
}): string {
  const { number, status, issueDate, dueDate, hasService, suspendDay, today } =
    params;

  if (status !== "past_due") {
    return `Invoice ${number} is due by ${formatDate(dueDate)}.`;
  }

  const suspendOn = addDays(issueDate, suspendDay);
  if (hasService && suspendOn > today) {
    return `Invoice ${number} is overdue. Pay by ${formatDate(suspendOn)} to avoid your service being suspended.`;
  }
  if (hasService) {
    return `Invoice ${number} is overdue. Settle it and any suspended service reactivates automatically.`;
  }
  return `Invoice ${number} is overdue. Please settle it when you can.`;
}

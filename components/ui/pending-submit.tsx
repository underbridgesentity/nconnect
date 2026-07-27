"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The one submit button that shows it heard you.
 *
 * Every step of the funnel is a form submit plus a round trip. On a mid-range
 * Android that gap is long enough to look like nothing happened, so people tap
 * again, and on the pay screens the second tap is a second payment attempt.
 * This button disables itself and says what is happening instead.
 *
 * Two kinds of form need covering:
 *
 * - Server actions, where React drives the submission and `useFormStatus`
 *   reports it.
 * - Forms that post straight to an external URL, PayFast's checkout being the
 *   one that matters. React knows nothing about those, so pass `native` and
 *   the button listens for its own form's submit event.
 *
 * The listener sits on the form rather than on the button's own click, because
 * a `<button>` that is disabled by its click handler never runs its activation
 * behaviour and the form would silently not submit at all. By the time the
 * submit event fires the browser has already committed to sending it, so
 * disabling then is safe, and it also covers submitting with the Enter key.
 */
export function PendingSubmit({
  children,
  pendingLabel,
  className,
  ariaLabel,
  native = false,
}: {
  children: React.ReactNode;
  /** What is happening, in words, e.g. "Taking you to PayFast...". */
  pendingLabel: string;
  className?: string;
  ariaLabel?: string;
  /** The form posts to an external URL rather than running a server action. */
  native?: boolean;
}) {
  const { pending: actionPending } = useFormStatus();
  const [submitted, setSubmitted] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!native) return;
    const form = ref.current?.form;
    if (!form) return;
    const onSubmit = () => setSubmitted(true);
    form.addEventListener("submit", onSubmit);
    return () => form.removeEventListener("submit", onSubmit);
  }, [native]);

  useEffect(() => {
    if (!native) return;
    /*
     * A native post leaves this page. Coming back with the browser's back
     * button can restore it from the bfcache exactly as it was, button still
     * disabled and no way to try again, which on a pay link means a customer
     * who cannot pay. `pageshow` fires on that restore.
     */
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) setSubmitted(false);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, [native]);

  const pending = actionPending || submitted;

  return (
    <button
      ref={ref}
      type="submit"
      disabled={pending}
      aria-label={ariaLabel}
      aria-busy={pending || undefined}
      className={cn(className, pending && "opacity-70")}
    >
      {pending ? (
        <span className="flex items-center justify-center gap-2">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {pendingLabel}
        </span>
      ) : (
        children
      )}
    </button>
  );
}

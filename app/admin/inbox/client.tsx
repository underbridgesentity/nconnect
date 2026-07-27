"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { replyAction, assignAction, statusAction, type Result } from "./actions";

function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<Result>, done?: () => void) =>
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        router.refresh();
        done?.();
      } else toast.error(r.error ?? "Failed");
    });
  return { pending, run };
}

/**
 * Scrolls the thread to the newest message on open and after every reply.
 * A long conversation used to open on its first message, with the reply the
 * operator needs to read off the bottom of the scroll container.
 */
export function ScrollToNewest() {
  const anchor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    anchor.current?.scrollIntoView({ block: "end" });
  });
  return <div ref={anchor} aria-hidden />;
}

export function ReplyBox({ conversationId }: { conversationId: string }) {
  const { pending, run } = useRun();
  const formRef = useRef<HTMLFormElement>(null);
  const [internal, setInternal] = useState(false);

  return (
    <form
      ref={formRef}
      className="space-y-2 border-t p-3"
      action={(form) => run(() => replyAction(form), () => formRef.current?.reset())}
    >
      <input type="hidden" name="conversationId" value={conversationId} />
      <Textarea
        name="body"
        rows={3}
        required
        placeholder={
          internal
            ? "Internal note, the customer never sees this"
            : "Reply, goes out on the conversation's channel"
        }
        className={internal ? "border-amber-300 bg-amber-50" : ""}
        onKeyDown={(event) => {
          // Cmd/Ctrl+Enter sends, the convention every chat tool uses.
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            formRef.current?.requestSubmit();
          }
        }}
      />
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox
            name="internal"
            checked={internal}
            onCheckedChange={(v) => setInternal(v === true)}
          />
          Internal note
        </label>
        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-muted-foreground sm:inline">
            Ctrl+Enter to send
          </span>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Sending…" : internal ? "Add note" : "Send reply"}
          </Button>
        </div>
      </div>
    </form>
  );
}

export function AssignSelect({
  conversationId,
  current,
  staff,
}: {
  conversationId: string;
  current: string | null;
  staff: { id: string; name: string }[];
}) {
  const { pending, run } = useRun();
  return (
    <Select
      value={current ?? "none"}
      onValueChange={(v) =>
        run(() => assignAction(conversationId, v === "none" ? null : v))
      }
      disabled={pending}
    >
      <SelectTrigger className="h-8 w-36 text-xs" aria-label="Assign to">
        <SelectValue placeholder="Unassigned" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">Unassigned</SelectItem>
        {staff.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function StatusButtons({
  conversationId,
  status,
}: {
  conversationId: string;
  status: string;
}) {
  const { pending, run } = useRun();
  return status === "resolved" ? (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => run(() => statusAction(conversationId, "open"))}
    >
      Reopen
    </Button>
  ) : (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => run(() => statusAction(conversationId, "resolved"))}
    >
      Resolve
    </Button>
  );
}

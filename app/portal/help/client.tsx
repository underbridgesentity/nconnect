"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { runAction } from "@/app/portal/_lib/run-action";
import {
  startPortalConversationAction,
  portalReplyAction,
  type Result,
} from "./actions";

export function NewConversationForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} className="w-full touch-target">
        <Plus className="size-4" /> Start a conversation
      </Button>
    );
  }

  return (
    <form
      className="space-y-3 rounded-2xl border bg-card p-4"
      action={(form) =>
        startTransition(async () => {
          const r: Result = await runAction(() =>
            startPortalConversationAction(form)
          );
          if (r.ok && r.conversationId) {
            toast.success("Sent, we'll get back to you");
            router.push(`/portal/help/${r.conversationId}`);
          } else toast.error(r.error ?? "Failed");
        })
      }
    >
      <div className="space-y-1.5">
        <Label htmlFor="subject">What&apos;s it about?</Label>
        <Input
          id="subject"
          name="subject"
          placeholder="e.g. Slow speeds in the evening"
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="body">Tell us what&apos;s happening</Label>
        <Textarea id="body" name="body" rows={4} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="photo">Add a photo (optional)</Label>
        <Input id="photo" name="photo" type="file" accept="image/*" />
      </div>
      <div className="flex gap-2">
        <Button
          type="submit"
          disabled={pending}
          className="flex-1 touch-target"
        >
          {pending ? "Sending…" : "Send"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => setOpen(false)}
          className="touch-target"
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function PortalReplyBox({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const replyId = useId();
  const photoId = useId();

  return (
    <form
      ref={formRef}
      className="space-y-2 border-t p-3"
      action={(form) =>
        startTransition(async () => {
          const r = await runAction(() => portalReplyAction(form));
          if (r.ok) {
            formRef.current?.reset();
            router.refresh();
          } else toast.error(r.error ?? "Failed");
        })
      }
    >
      <input type="hidden" name="conversationId" value={conversationId} />
      <Label htmlFor={replyId} className="text-xs text-muted-foreground">
        Your reply
      </Label>
      <Textarea
        id={replyId}
        name="body"
        rows={2}
        required
        placeholder="Write a reply…"
      />
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <Label htmlFor={photoId} className="sr-only">
            Attach a photo
          </Label>
          <Input
            id={photoId}
            name="photo"
            type="file"
            accept="image/*"
            className="max-w-48 text-xs"
          />
        </div>
        <Button type="submit" disabled={pending} className="touch-target">
          {pending ? "Sending…" : "Send"}
        </Button>
      </div>
    </form>
  );
}

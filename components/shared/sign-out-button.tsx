import { signOut } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

export function SignOutButton({
  compact = false,
  tone = "light",
}: {
  compact?: boolean;
  tone?: "light" | "dark";
}) {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/" });
      }}
    >
      <Button
        type="submit"
        variant="ghost"
        size={compact ? "icon" : "sm"}
        className={
          tone === "dark"
            ? "text-white/70 hover:bg-white/10 hover:text-white"
            : "text-muted-foreground"
        }
        aria-label="Sign out"
      >
        <LogOut className="size-4" />
        {compact ? null : "Sign out"}
      </Button>
    </form>
  );
}

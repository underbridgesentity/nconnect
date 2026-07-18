import { signOut } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

export function SignOutButton({ compact = false }: { compact?: boolean }) {
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
        className="text-muted-foreground"
        aria-label="Sign out"
      >
        <LogOut className="size-4" />
        {compact ? null : "Sign out"}
      </Button>
    </form>
  );
}

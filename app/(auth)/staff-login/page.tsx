import type { Metadata } from "next";
import { StaffLoginForm } from "./staff-form";

export const metadata: Metadata = {
  title: "Staff sign in",
};

export default function StaffLoginPage() {
  return (
    <div className="rounded-lg border bg-card p-6">
      <h1 className="text-xl font-semibold tracking-tight">Staff sign in</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        For Needd Connect team members.
      </p>
      <div className="mt-6">
        <StaffLoginForm />
      </div>
    </div>
  );
}

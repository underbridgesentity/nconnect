import type { Metadata } from "next";
import Link from "next/link";
import { callbackUrlFromParams } from "@/lib/auth/callback-url";
import { StaffLoginForm } from "./staff-form";

export const metadata: Metadata = {
  title: "Staff sign in",
  robots: { index: false },
};

export default async function StaffLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const callbackUrl = callbackUrlFromParams(await searchParams);

  return (
    <div className="rounded-3xl border bg-card p-6 shadow-sm sm:p-7">
      <h1 className="font-heading text-2xl font-semibold tracking-tight">
        Staff sign in
      </h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        For Needd Connect team members.
      </p>
      <div className="mt-6">
        <StaffLoginForm callbackUrl={callbackUrl ?? undefined} />
      </div>
      <p className="mt-6 border-t pt-5 text-sm text-muted-foreground">
        A customer?{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in with your cellphone
        </Link>
        .
      </p>
    </div>
  );
}

import type { Metadata } from "next";
import { SetupForm } from "./form";

export const metadata: Metadata = {
  title: "Set up your account",
  robots: { index: false },
};

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (!token) {
    return (
      <div className="rounded-lg border bg-card p-6">
        <h1 className="text-xl font-semibold">Missing setup link</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Open the link from your invitation email — it carries your one-time
          setup token.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border bg-card p-6">
      <h1 className="text-xl font-semibold tracking-tight">
        Welcome to Needd Connect
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Set your name and password to activate your staff account.
      </p>
      <div className="mt-6">
        <SetupForm token={token} />
      </div>
    </div>
  );
}

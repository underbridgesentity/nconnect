import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { hash as argon2Hash } from "@node-rs/argon2";
import { db } from "@/lib/db/client";
import { users, inviteTokens } from "@/lib/db/schema";
import { authorize, type Actor } from "@/lib/auth/authorize";
import { writeAudit } from "./audit";
import { sha256 } from "@/lib/crypto";
import { sendEmail } from "@/lib/notify/email";

/**
 * Staff management (spec §9.4.6, §10.1): invite by email with a one-time
 * setup link (7 days), role assignment, disable (hard-blocked in proxy).
 */

export async function inviteStaff(
  actor: Actor,
  input: { email: string; name: string; role: "admin" | "sales" }
): Promise<void> {
  authorize(actor, "staff.manage");
  const email = input.email.trim().toLowerCase();

  const token = randomBytes(24).toString("base64url");
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    let userId: string;
    if (existing) {
      if (existing.status !== "invited") {
        throw new Error("That email already has an active account");
      }
      userId = existing.id;
    } else {
      const [user] = await tx
        .insert(users)
        .values({ role: input.role, email, name: input.name, status: "invited" })
        .returning({ id: users.id });
      userId = user.id;
    }
    await tx.insert(inviteTokens).values({
      userId,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
    });
    await writeAudit(tx, {
      actor,
      action: "staff.invite",
      entity: "user",
      entityId: userId,
      after: { email, role: input.role },
    });
  });

  const link = `${process.env.APP_URL}/setup?token=${token}`;
  await sendEmail({
    to: email,
    subject: "You've been invited to Needd Connect",
    html: `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px"><p>Hi ${input.name},</p><p>You've been invited to the Needd Connect ${input.role} workspace.</p><p><a href="${link}">Set your password</a> — the link is valid for 7 days.</p></div>`,
    text: `Set up your Needd Connect account: ${link}`,
  });
}

export async function completeSetup(input: {
  token: string;
  name: string;
  password: string;
}): Promise<{ email: string }> {
  if (input.password.length < 10) {
    throw new Error("Password must be at least 10 characters");
  }
  const tokenHash = sha256(input.token);
  return db.transaction(async (tx) => {
    const [invite] = await tx
      .select()
      .from(inviteTokens)
      .where(
        and(
          eq(inviteTokens.tokenHash, tokenHash),
          isNull(inviteTokens.usedAt),
          gt(inviteTokens.expiresAt, new Date())
        )
      )
      .limit(1);
    if (!invite) throw new Error("This setup link is invalid or has expired");

    const passwordHash = await argon2Hash(input.password);
    const [user] = await tx
      .update(users)
      .set({ name: input.name, passwordHash, status: "active" })
      .where(eq(users.id, invite.userId))
      .returning({ email: users.email });
    await tx
      .update(inviteTokens)
      .set({ usedAt: new Date() })
      .where(eq(inviteTokens.id, invite.id));
    await writeAudit(tx, {
      actor: null,
      action: "staff.setup_complete",
      entity: "user",
      entityId: invite.userId,
      after: { name: input.name },
    });
    return { email: user.email! };
  });
}

export async function setStaffStatus(
  actor: Actor,
  userId: string,
  status: "active" | "disabled"
): Promise<void> {
  authorize(actor, "staff.manage");
  if (userId === actor.userId) throw new Error("You can't disable yourself");
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select({ status: users.status, role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!before) throw new Error("User not found");
    if (before.role === "customer") throw new Error("Not a staff account");
    await tx.update(users).set({ status }).where(eq(users.id, userId));
    await writeAudit(tx, {
      actor,
      action: `staff.${status === "disabled" ? "disable" : "enable"}`,
      entity: "user",
      entityId: userId,
      before: { status: before.status },
      after: { status },
    });
  });
}

export async function setStaffRole(
  actor: Actor,
  userId: string,
  role: "admin" | "sales"
): Promise<void> {
  authorize(actor, "staff.manage");
  if (userId === actor.userId) throw new Error("You can't change your own role");
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!before || before.role === "customer") throw new Error("Not a staff account");
    await tx.update(users).set({ role }).where(eq(users.id, userId));
    await writeAudit(tx, {
      actor,
      action: "staff.role_change",
      entity: "user",
      entityId: userId,
      before: { role: before.role },
      after: { role },
    });
  });
}

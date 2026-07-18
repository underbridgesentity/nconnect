import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { verify as argon2Verify } from "@node-rs/argon2";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users, customers } from "@/lib/db/schema";
import { verifyOtp } from "./otp";
import type { Role } from "./permissions";
import type { Actor } from "./authorize";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      customerId?: string;
    } & DefaultSession["user"];
  }
  interface User {
    role?: Role;
    customerId?: string;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      id: "staff",
      name: "Staff",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = (credentials?.email as string | undefined)
          ?.trim()
          .toLowerCase();
        const password = credentials?.password as string | undefined;
        if (!email || !password) return null;

        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.email, email))
          .limit(1);
        if (!user || !user.passwordHash) return null;
        if (user.role === "customer") return null;
        if (user.status !== "active") return null;

        const valid = await argon2Verify(user.passwordHash, password);
        if (!valid) return null;

        await db
          .update(users)
          .set({ lastLoginAt: new Date() })
          .where(eq(users.id, user.id));

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        };
      },
    }),
    Credentials({
      id: "customer-otp",
      name: "Customer OTP",
      credentials: {
        phone: { label: "Phone", type: "tel" },
        code: { label: "Code", type: "text" },
      },
      async authorize(credentials) {
        const phone = credentials?.phone as string | undefined;
        const code = credentials?.code as string | undefined;
        if (!phone || !code) return null;

        const result = await verifyOtp(phone, code);
        if (!result.ok) return null;

        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.phone, result.phone))
          .limit(1);
        if (!user || user.status === "disabled") return null;
        if (user.role !== "customer") return null;

        const [customer] = await db
          .select({ id: customers.id })
          .from(customers)
          .where(eq(customers.userId, user.id))
          .limit(1);

        await db
          .update(users)
          .set({ lastLoginAt: new Date(), status: "active" })
          .where(eq(users.id, user.id));

        return {
          id: user.id,
          name: user.name,
          role: "customer" as const,
          customerId: customer?.id,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
        token.role = user.role;
        token.customerId = user.customerId;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.userId as string;
      session.user.role = token.role as Role;
      session.user.customerId = token.customerId as string | undefined;
      return session;
    },
  },
});

/** The session's actor for authorize(); null when unauthenticated. */
export async function currentActor(): Promise<Actor | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return {
    userId: session.user.id,
    role: session.user.role,
    customerId: session.user.customerId,
  };
}

/** Throwing variant for domain call sites. */
export async function requireActor(): Promise<Actor> {
  const actor = await currentActor();
  if (!actor) throw new Error("Not authenticated");
  return actor;
}

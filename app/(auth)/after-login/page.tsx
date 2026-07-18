import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

/** Post-login role router: staff land in their own surface. */
export default async function AfterLoginPage() {
  const session = await auth();
  const role = session?.user?.role;
  if (role === "admin") redirect("/admin");
  if (role === "sales") redirect("/sales");
  if (role === "customer") redirect("/portal");
  redirect("/login");
}

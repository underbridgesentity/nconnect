"use client";

import { useCallback, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MenuIcon, XIcon } from "lucide-react";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { pillClass } from "@/components/public/pill";
import {
  COMPANY_NAV,
  PRIMARY_NAV,
  isActiveRoute,
} from "@/components/public/nav-items";

/**
 * The mobile menu.
 *
 * It replaces a horizontally scrolling strip of pills that ate roughly 110px
 * of a 390px viewport on every page and gave no hint that it scrolled. The
 * header is now one 64px row and the sections live in a full height sheet.
 *
 * Accessibility comes from the Base UI dialog underneath Sheet: the trigger is
 * a real button carrying aria-expanded and aria-controls, focus is trapped
 * while the sheet is open, Escape closes it and focus returns to the trigger.
 * The two things the primitive cannot know about are handled here: closing on
 * a route change, and closing when the tapped link is the page you are already
 * on (where the pathname never changes).
 *
 * Hidden under `scripting: none` because a button that needs JavaScript is a
 * dead end without it; the header renders a plain link list in that case.
 */
export function MobileMenu() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [shownFor, setShownFor] = useState(pathname);
  const close = useCallback(() => setOpen(false), []);

  // Adjust state during render rather than in an effect: a back or forward
  // navigation must not leave the sheet covering the page it landed on.
  if (shownFor !== pathname) {
    setShownFor(pathname);
    setOpen(false);
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger className="touch-target -mr-1.5 inline-flex items-center justify-center rounded-full text-foreground transition-colors hover:bg-accent lg:hidden [@media(scripting:none)]:hidden">
        <MenuIcon className="size-6" aria-hidden />
        <span className="sr-only">Menu</span>
      </SheetTrigger>

      <SheetContent
        side="right"
        showCloseButton={false}
        data-surface="ink"
        className="gap-0 border-white/10 bg-[#121829] p-0 text-white data-[side=right]:w-full"
      >
        <SheetTitle className="sr-only">Site menu</SheetTitle>

        <div className="flex h-full flex-col">
          <div className="flex h-16 shrink-0 items-center justify-between gap-3 px-4">
            <Link href="/" onClick={close} aria-label="Needd Connect home">
              <Image
                src="/brand/logo-white.png"
                alt="Needd Connect"
                width={124}
                height={18}
                className="h-[18px] w-auto"
              />
            </Link>
            <SheetClose className="touch-target -mr-1.5 inline-flex items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white">
              <XIcon className="size-5" aria-hidden />
              <span className="sr-only">Close menu</span>
            </SheetClose>
          </div>

          <nav
            aria-label="Site sections"
            className="min-h-0 flex-1 overflow-y-auto px-3 pb-6"
          >
            <ul>
              {PRIMARY_NAV.map((item) => {
                const active = isActiveRoute(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={close}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex min-h-12 items-center rounded-xl px-3 text-base font-medium transition-colors",
                        active
                          ? "bg-white/10 text-white"
                          : "text-white/70 hover:bg-white/5 hover:text-white"
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>

            <h3 className="mt-6 px-3 text-xs font-semibold uppercase tracking-[0.14em] text-white/50">
              Company
            </h3>
            <ul className="mt-1">
              {COMPANY_NAV.map((item) => {
                const active = isActiveRoute(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={close}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex min-h-11 items-center rounded-xl px-3 text-sm transition-colors",
                        active
                          ? "bg-white/10 text-white"
                          : "text-white/60 hover:bg-white/5 hover:text-white"
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="shrink-0 space-y-2 border-t border-white/10 p-4">
            <Link
              href="/signup"
              onClick={close}
              className={pillClass("primary", "w-full")}
            >
              Get connected
            </Link>
            <Link
              href="/login"
              onClick={close}
              className={pillClass("ink", "w-full")}
            >
              Sign in
            </Link>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

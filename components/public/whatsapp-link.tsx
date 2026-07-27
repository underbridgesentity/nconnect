import { MessageCircle } from "lucide-react";
import type { ReactNode } from "react";
import { PillLink, type PillVariant } from "@/components/public/pill";

/**
 * The WhatsApp call to action. Only ever rendered with an href from
 * whatsappHref(), which returns null unless settings carry a real mobile
 * number, so the site never offers a WhatsApp link that cannot open.
 */
export function WhatsAppPill({
  href,
  variant = "primary",
  className,
  children = "Chat on WhatsApp",
}: {
  href: string;
  variant?: PillVariant;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <PillLink
      href={href}
      variant={variant}
      className={className}
      target="_blank"
      rel="noopener noreferrer"
    >
      <MessageCircle className="size-4" aria-hidden />
      {children}
      <span className="sr-only"> (opens WhatsApp in a new tab)</span>
    </PillLink>
  );
}

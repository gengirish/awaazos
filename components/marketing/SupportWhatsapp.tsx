import { MessageCircle } from "lucide-react";

import { supportWhatsappUrl } from "@/lib/support-whatsapp";
import { cn } from "@/lib/utils";

/**
 * "Chat with us on WhatsApp" for the marketing pages: a floating button, and a
 * plain link for the footer. Neither renders without NEXT_PUBLIC_SUPPORT_WHATSAPP
 * (lib/support-whatsapp.ts). The chat opens in the visitor's own WhatsApp.
 */
export function SupportWhatsappButton() {
  const href = supportWhatsappUrl();
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat with us on WhatsApp"
      className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] z-40 inline-flex min-h-12 min-w-12 items-center justify-center gap-2 rounded-full bg-awaaz-charcoal px-4 text-sm font-semibold text-white shadow-lg outline-hidden transition-colors hover:bg-awaaz-charcoal/90 focus-visible:ring-2 focus-visible:ring-awaaz-orange focus-visible:ring-offset-2"
    >
      <MessageCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
      <span className="hidden sm:inline">Chat with us</span>
    </a>
  );
}

/** " or WhatsApp us", to follow the support email in a sentence; nothing without a number. */
export function SupportWhatsappLink({ className }: { className?: string }) {
  const href = supportWhatsappUrl();
  if (!href) return null;
  return (
    <>
      {" or "}
      <a href={href} target="_blank" rel="noopener noreferrer" className={cn(className)}>
        WhatsApp us
      </a>
    </>
  );
}

import { Mail, MessageCircle, Phone, Send } from "lucide-react";
import Link from "next/link";

import { supportContacts, type SupportContact } from "@/lib/support-contact";

const ICON = { whatsapp: MessageCircle, email: Mail, phone: Phone, form: Send } as const;

/**
 * "Contact support" rows for Help and Settings. A server component: the support
 * WhatsApp is read from NEXT_PUBLIC_SUPPORT_WHATSAPP on each render.
 */
export function SupportContactList({ headingId }: { headingId: string }) {
  const contacts = supportContacts(process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP);
  return (
    <ul aria-labelledby={headingId} className="divide-y divide-border overflow-hidden rounded-lg border bg-card">
      {contacts.map((c) => (
        <li key={c.id}>
          <Row contact={c} />
        </li>
      ))}
    </ul>
  );
}

function Row({ contact }: { contact: SupportContact }) {
  const Icon = ICON[contact.id];
  const className =
    "flex min-h-14 items-center gap-3 px-4 py-3 ring-inset transition-colors hover:bg-muted/50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";
  const body = (
    <>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-foreground">{contact.label}</span>
        <span className="block break-all text-sm text-muted-foreground">{contact.detail}</span>
      </span>
    </>
  );
  return contact.external ? (
    <a
      href={contact.href}
      className={className}
      {...(contact.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {body}
    </a>
  ) : (
    <Link href={contact.href} className={className}>
      {body}
    </Link>
  );
}

import { Mail, Phone } from "lucide-react";

import { OutreachWhatsApp } from "@/components/admin/OutreachWhatsApp";
import { Button } from "@/components/ui/button";
import { formatIndianMobile, normaliseIndianMobile } from "@/lib/phone";
import { feedbackMailtoUrl, feedbackRequestMessage, type StoreContact } from "@/lib/store-contact";

type Props = {
  contact: StoreContact;
  storeName: string;
  /** The signed-in admin, who signs the message. */
  senderName: string | null;
};

/**
 * A store's owner contacts on /admin/vendors, with a feedback and testimonial
 * ask ready to send from the admin's own email or WhatsApp.
 */
export function StoreContactCard({ contact, storeName, senderName }: Props) {
  const message = feedbackRequestMessage({ ownerName: contact.ownerName, storeName, senderName });
  const mailto = feedbackMailtoUrl(contact.emails, message);
  const whatsappTo = contact.phones[0]?.number ?? null;

  if (contact.emails.length === 0 && contact.phones.length === 0) {
    return <p className="mt-3 text-xs text-muted-foreground">Owner contact: none saved.</p>;
  }

  return (
    <div className="mt-3 rounded-md border p-3 text-sm">
      <p className="font-medium text-foreground">
        Owner{contact.ownerName ? `: ${contact.ownerName}` : ""}
      </p>
      <ul className="mt-1 space-y-1">
        {contact.emails.map((email) => (
          <li key={email} className="flex min-w-0 items-center gap-2">
            <Mail aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <a href={`mailto:${email}`} className="min-h-11 content-center truncate text-primary underline-offset-4 hover:underline md:min-h-0">
              {email}
            </a>
          </li>
        ))}
        {contact.phones.map(({ number, label }) => (
          <li key={number} className="flex min-w-0 items-center gap-2">
            <Phone aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <a
              href={`tel:${normaliseIndianMobile(number)}`}
              className="min-h-11 content-center font-mono text-primary underline-offset-4 hover:underline md:min-h-0"
            >
              {formatIndianMobile(normaliseIndianMobile(number))}
            </a>
            <span className="text-xs text-muted-foreground">{label}</span>
          </li>
        ))}
      </ul>

      <details className="mt-2">
        <summary className="min-h-11 cursor-pointer content-center text-sm font-medium text-primary md:min-h-0">
          Ask for feedback
        </summary>
        <div className="mt-3 space-y-3">
          {mailto ? (
            <Button asChild variant="outline">
              <a href={mailto}>
                <Mail aria-hidden className="size-4" />
                Email the owner
              </a>
            </Button>
          ) : null}
          {whatsappTo ? (
            <OutreachWhatsApp phone={whatsappTo} message={message} label="Message on WhatsApp" />
          ) : null}
          {mailto && whatsappTo ? (
            <p className="text-xs text-muted-foreground">
              The email uses the text as written above; edits in the box go to WhatsApp only.
            </p>
          ) : null}
        </div>
      </details>
    </div>
  );
}

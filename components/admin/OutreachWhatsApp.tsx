"use client";

import { useId, useState } from "react";
import { MessageCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { formatIndianMobile } from "@/lib/phone";
import { outreachWhatsappUrl } from "@/lib/outreach-message";

const FIELD =
  "flex w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

type Props = {
  /** The seller's business number, E.164 or 10 digits; null → WhatsApp asks which chat. */
  phone: string | null;
  /** The message to start from; the admin can edit it before opening WhatsApp. */
  message: string;
  /** Button text, e.g. "Message on WhatsApp". */
  label: string;
};

/**
 * An editable WhatsApp message and a button that opens the admin's own
 * WhatsApp (wa.me) with it filled in. Nothing is sent until they tap send there.
 */
export function OutreachWhatsApp({ phone, message, label }: Props) {
  const id = useId();
  const [text, setText] = useState(message);
  const href = outreachWhatsappUrl(text, phone);
  const shownPhone = phone ? formatIndianMobile(phone) : null;

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Message</Label>
      <textarea
        id={id}
        className={`${FIELD} min-h-48 text-sm`}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <p className="text-xs text-muted-foreground">
        {shownPhone
          ? `Opens your WhatsApp with a chat to ${shownPhone}. Nothing is sent until you tap send.`
          : "No business number saved for this seller, so WhatsApp will ask which chat. Nothing is sent until you tap send."}
      </p>
      {href ? (
        <Button asChild className="bg-success text-success-foreground hover:bg-success/90">
          <a href={href} target="_blank" rel="noopener noreferrer">
            <MessageCircle aria-hidden className="size-4" />
            {label}
          </a>
        </Button>
      ) : (
        <p role="alert" className="text-sm text-destructive">
          The saved number doesn&apos;t look like a valid mobile number, so WhatsApp can&apos;t open a chat.
        </p>
      )}
    </div>
  );
}

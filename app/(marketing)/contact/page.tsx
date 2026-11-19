import type { Metadata } from "next";
import { Mail, MapPin, Phone } from "lucide-react";

import { ContactForm } from "@/components/marketing/ContactForm";
import { BRAND_NAME } from "@/lib/brand";
import {
  BUSINESS_ADDRESS_LINES,
  BUSINESS_BRAND,
  BUSINESS_GSTIN,
  BUSINESS_NAME,
  SUPPORT_EMAIL,
  SUPPORT_PHONE_DISPLAY,
  SUPPORT_PHONE_E164,
} from "@/lib/business-contact";

export const metadata: Metadata = {
  title: `Contact us — ${BRAND_NAME}`,
  description: `Email, call or write to the team behind ${BRAND_NAME} in Hyderabad.`,
};

const linkClass =
  "inline-flex min-h-11 items-center font-medium text-foreground underline underline-offset-4 outline-hidden break-all hover:text-primary focus-visible:ring-2 focus-visible:ring-ring";

/** Public contact page: who runs the product, how to reach them, and a form (lib/contact-message.ts). */
export default function ContactPage() {
  return (
    <div className="px-4 py-10 sm:px-6 sm:py-14">
      <div className="mx-auto max-w-5xl">
        <h1 className="font-display text-3xl font-bold tracking-tight text-balance text-foreground sm:text-4xl">
          Contact us
        </h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Questions about {BRAND_NAME}, your plan or a payment? Send us a message, email or call. We usually reply
          within one working day.
        </p>
        <p className="mt-3 text-sm font-medium text-foreground">Aligned with Bharat AI Mission</p>

        <div className="mt-8 grid gap-6 md:grid-cols-5">
          <section aria-labelledby="contact-details" className="rounded-lg border bg-card p-5 shadow-xs md:col-span-2">
            <h2 id="contact-details" className="font-display text-xl font-semibold text-foreground">
              {BUSINESS_NAME}
            </h2>
            <p className="text-sm text-muted-foreground">{BUSINESS_BRAND}</p>
            <ul className="mt-4 space-y-3 text-sm text-foreground">
              <li className="flex gap-3">
                <Mail aria-hidden className="mt-3.5 size-4 shrink-0 text-muted-foreground" />
                <a href={`mailto:${SUPPORT_EMAIL}`} className={linkClass}>
                  {SUPPORT_EMAIL}
                </a>
              </li>
              <li className="flex gap-3">
                <Phone aria-hidden className="mt-3.5 size-4 shrink-0 text-muted-foreground" />
                <a href={`tel:${SUPPORT_PHONE_E164}`} className={linkClass}>
                  {SUPPORT_PHONE_DISPLAY}
                </a>
              </li>
              <li className="flex gap-3">
                <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <address className="not-italic leading-6">
                  {BUSINESS_ADDRESS_LINES.map((line) => (
                    <span key={line} className="block">
                      {line}
                    </span>
                  ))}
                </address>
              </li>
            </ul>
            <p className="mt-4 text-sm text-muted-foreground">GSTIN: {BUSINESS_GSTIN}</p>
          </section>

          <section aria-labelledby="contact-form" className="rounded-lg border bg-card p-5 shadow-xs md:col-span-3">
            <h2 id="contact-form" className="font-display text-xl font-semibold text-foreground">
              Send us a message
            </h2>
            <div className="mt-4">
              <ContactForm />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

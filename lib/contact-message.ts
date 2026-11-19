/**
 * The public contact form (/contact → POST /api/contact). A message is emailed to
 * SUPPORT_EMAIL and stored nowhere: no table, no log line with its contents (the
 * sender's name, email, phone and words are PII). The route answers 503 when the
 * email didn't go, so the page can point the sender at the email and phone instead
 * of pretending it was sent.
 *
 * `website` is a honeypot: hidden from people, filled by naive bots. A filled one
 * gets the same 201 and is dropped.
 *
 * zod-free so the form can import the limits; the schema is in contact-message-schema.ts.
 */

export const CONTACT_NAME_MAX = 80;
export const CONTACT_EMAIL_MAX = 254;
export const CONTACT_PHONE_MAX = 20;
export const CONTACT_MESSAGE_MIN = 10;
export const CONTACT_MESSAGE_MAX = 2000;

export type ContactMessage = {
  name: string;
  email: string;
  /** E.164 (`+919876543210`), or "" when not given. */
  phone: string;
  message: string;
};

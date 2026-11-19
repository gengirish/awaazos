import { SUPPORT_EMAIL } from "@/lib/business-contact";

export function SupportEmailLink() {
  return <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>;
}

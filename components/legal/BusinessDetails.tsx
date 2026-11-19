import { SupportEmailLink } from "@/components/legal/SupportEmailLink";
import {
  BUSINESS_ADDRESS_LINES,
  BUSINESS_BRAND,
  BUSINESS_GSTIN,
  BUSINESS_NAME,
  BUSINESS_PROPRIETOR,
  SUPPORT_PHONE_DISPLAY,
  SUPPORT_PHONE_E164,
} from "@/lib/business-contact";

export { BUSINESS_NAME };

/** The business that runs AwaazDo, as registered for GST (lib/business-contact.ts). */
export function BusinessDetails() {
  return (
    <p>
      {BUSINESS_NAME} ({BUSINESS_BRAND})<br />
      Proprietor: {BUSINESS_PROPRIETOR}<br />
      {BUSINESS_ADDRESS_LINES.join(", ")}<br />
      GSTIN: {BUSINESS_GSTIN}<br />
      Email: <SupportEmailLink /><br />
      Phone: <a href={`tel:${SUPPORT_PHONE_E164}`}>{SUPPORT_PHONE_DISPLAY}</a>
    </p>
  );
}

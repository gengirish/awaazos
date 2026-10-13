import { SupportEmailLink } from "@/components/legal/SupportEmailLink";

/** Registered trade name on the GST certificate; "IntelliForge AI" is the brand. */
export const BUSINESS_NAME = "IntelliForge Digital Services";

/** The business that runs AwaazOS, as registered for GST. */
export function BusinessDetails() {
  return (
    <p>
      {BUSINESS_NAME} (IntelliForge AI)<br />
      Proprietor: Girish Basavaraj Hiremath<br />
      Kondapur, Hyderabad 500084<br />
      GSTIN: 36ADQPH9644E1Z7<br />
      Email: <SupportEmailLink />
    </p>
  );
}

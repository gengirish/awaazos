/**
 * Who runs the product and how to reach them: the registered business on the GST
 * certificate, shown on /contact and the legal pages (Razorpay's website review
 * reads them). Pure constants, safe in client components.
 */

/** Registered trade name on the GST certificate; "IntelliForge AI" is the brand. */
export const BUSINESS_NAME = "IntelliForge Digital Services";
export const BUSINESS_BRAND = "IntelliForge AI";
export const BUSINESS_PROPRIETOR = "Girish Basavaraj Hiremath";
export const BUSINESS_GSTIN = "36ADQPH9644E1Z7";

export const SUPPORT_EMAIL = "contact@intelliforge.tech";
export const SUPPORT_PHONE_E164 = "+918555960837";
export const SUPPORT_PHONE_DISPLAY = "+91 85559 60837";

export const BUSINESS_ADDRESS_LINES = [
  "Vamsiram's Jyothi Granules, Tower-2",
  "Kondapur Main Road, Opp. Chirec School",
  "Laxmi Nagar, Kondapur",
  "Hyderabad, Telangana 500084",
] as const;

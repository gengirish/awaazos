import { MarketingChrome } from "@/components/marketing/MarketingChrome";
import { auth } from "@/lib/auth";

/**
 * /pricing has this layout of its own because its header depends on the session:
 * reading that in the (marketing) layout would stop the landing page being static.
 */
export default async function PricingLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  return <MarketingChrome signedIn={Boolean(session?.user)}>{children}</MarketingChrome>;
}

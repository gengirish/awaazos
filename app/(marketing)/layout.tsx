import { MarketingChrome } from "@/components/marketing/MarketingChrome";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <MarketingChrome>{children}</MarketingChrome>;
}

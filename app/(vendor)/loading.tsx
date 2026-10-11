import { PageSkeleton } from "@/components/shell/PageSkeleton";

/** Shown inside the app shell while any vendor page loads; the navigation stays put. */
export default function VendorLoading() {
  return <PageSkeleton />;
}

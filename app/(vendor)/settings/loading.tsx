import { PageSkeleton } from "@/components/shell/PageSkeleton";

/**
 * Settings has its own layout (section sidebar on md+). A boundary here keeps
 * that sidebar on screen while moving between sections, instead of falling
 * back to the whole-page skeleton.
 */
export default function SettingsLoading() {
  return <PageSkeleton className="mx-0 max-w-none p-0 md:p-0" />;
}

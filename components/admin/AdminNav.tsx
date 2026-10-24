import Link from "next/link";

const LINKS = [
  { href: "/admin/metrics", label: "Weekly metrics", superAdminOnly: false },
  { href: "/admin/vendors", label: "Stores and free access", superAdminOnly: true },
  { href: "/admin/demo-stores", label: "Demo-store pipeline", superAdminOnly: false },
  { href: "/admin/communities", label: "Community pages", superAdminOnly: false },
  { href: "/admin/pricing", label: "Pricing calculator", superAdminOnly: false },
  { href: "/admin/admins", label: "Admins", superAdminOnly: true },
] as const;

/** The admin pages link to each other here. Store and admin pages are SUPER_ADMIN only. */
export function AdminNav({ current, superAdmin }: { current: (typeof LINKS)[number]["href"]; superAdmin: boolean }) {
  const links = LINKS.filter((l) => l.href !== current && (superAdmin || !l.superAdminOnly));
  if (links.length === 0) return null;
  return (
    <nav aria-label="Admin" className="mt-2 flex flex-wrap gap-x-5">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4"
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * The suite registers vendors and rings up sales, and `.env` is what Prisma and
 * Next both read. These rules stop a run before it can write to a real database
 * or a deployment. Pure, so lib/__tests__/e2e-safety.test.ts can pin them.
 */

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$/;
const PRODUCTION_HOSTS = new Set(["awaazos.intelliforge.tech", "awaazos.vercel.app"]);

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Reason to refuse this run, or null when it is safe. `envFileUrls`: DATABASE_URLs found in .env files. */
export function e2eRefusal(input: {
  baseUrl?: string;
  databaseUrl?: string;
  envFileUrls: readonly string[];
  allowRemote: boolean;
}): string | null {
  const baseHost = input.baseUrl ? hostOf(input.baseUrl) : null;
  if (baseHost && PRODUCTION_HOSTS.has(baseHost)) {
    return `BASE_URL is production (${baseHost}). The vendor-creating specs would write to the live database.`;
  }
  if (baseHost && !LOCAL_HOST.test(baseHost)) {
    return input.allowRemote
      ? null
      : `BASE_URL is a deployment (${baseHost}), and specs write to its database. Set E2E_ALLOW_REMOTE=1 if that database is throwaway.`;
  }
  // An exported DATABASE_URL wins over .env files, for Next and Prisma alike.
  for (const url of input.databaseUrl ? [input.databaseUrl] : input.envFileUrls) {
    const host = hostOf(url);
    if (!host || !LOCAL_HOST.test(host)) {
      return `DATABASE_URL points at ${host ?? "an unreadable host"}, not a local throwaway Postgres. See CLAUDE.md, "E2E writes real rows".`;
    }
  }
  return null;
}

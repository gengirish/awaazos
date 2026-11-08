import fs from "node:fs";

import { e2eRefusal } from "./helpers/safety";

const ENV_FILES = [".env", ".env.local", ".env.development.local", ".env.production.local"];

function envFileDatabaseUrls(): string[] {
  const urls: string[] = [];
  for (const file of ENV_FILES) {
    if (!fs.existsSync(file)) continue;
    const match = /^\s*(?:export\s+)?DATABASE_URL\s*=\s*["']?([^"'\s]+)/m.exec(fs.readFileSync(file, "utf8"));
    if (match) urls.push(match[1]);
  }
  return urls;
}

/** Runs once before any spec. Never prints a connection string: it holds the password. */
export default function globalSetup(): void {
  const refusal = e2eRefusal({
    baseUrl: process.env.BASE_URL,
    databaseUrl: process.env.DATABASE_URL,
    envFileUrls: envFileDatabaseUrls(),
    allowRemote: process.env.E2E_ALLOW_REMOTE === "1",
  });
  if (refusal) throw new Error(`Refusing to run E2E: ${refusal}`);
}

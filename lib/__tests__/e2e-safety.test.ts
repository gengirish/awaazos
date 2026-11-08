import { describe, expect, it } from "vitest";

import { e2eRefusal } from "../../e2e/helpers/safety";

const LOCAL_DB = "postgresql://ci:ci@localhost:5432/awaazos?schema=public";
const NEON = "postgresql://u:p@ep-x-pooler.ap-south-1.aws.neon.tech/awaazos";
const safe = { envFileUrls: [], allowRemote: false };

describe("e2eRefusal", () => {
  it("allows a local server and a local database", () => {
    expect(e2eRefusal({ ...safe, databaseUrl: LOCAL_DB })).toBeNull();
    expect(e2eRefusal({ ...safe, baseUrl: "http://localhost:3100", databaseUrl: LOCAL_DB })).toBeNull();
    expect(e2eRefusal({ ...safe, databaseUrl: "postgresql://ci:ci@127.0.0.1:5433/a" })).toBeNull();
  });

  it("refuses a real database, exported or only in an env file", () => {
    expect(e2eRefusal({ ...safe, databaseUrl: NEON })).toMatch(/ep-x-pooler/);
    expect(e2eRefusal({ ...safe, envFileUrls: [NEON] })).toMatch(/ep-x-pooler/);
    expect(e2eRefusal({ ...safe, baseUrl: "http://localhost:3100", envFileUrls: [LOCAL_DB, NEON] })).not.toBeNull();
  });

  it("lets an exported local database win over a real one in .env", () => {
    expect(e2eRefusal({ ...safe, databaseUrl: LOCAL_DB, envFileUrls: [NEON] })).toBeNull();
  });

  it("never prints the password", () => {
    expect(e2eRefusal({ ...safe, databaseUrl: NEON })).not.toContain("u:p");
  });

  it("refuses an unreadable database URL", () => {
    expect(e2eRefusal({ ...safe, databaseUrl: "not a url" })).not.toBeNull();
  });

  it("always refuses production, even when remote runs are allowed", () => {
    for (const baseUrl of ["https://awaazos.intelliforge.tech", "https://awaazos.vercel.app/"]) {
      expect(e2eRefusal({ ...safe, baseUrl, allowRemote: true })).toMatch(/production/);
    }
  });

  it("needs an explicit allow for any other deployment", () => {
    const baseUrl = "https://staging.example.com";
    expect(e2eRefusal({ ...safe, baseUrl })).toMatch(/E2E_ALLOW_REMOTE/);
    expect(e2eRefusal({ ...safe, baseUrl, allowRemote: true })).toBeNull();
  });
});

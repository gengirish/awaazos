/**
 * Create the platform subscription plans in Razorpay (docs/RAZORPAY_SUBSCRIPTIONS_PLAN.md, Phase 0).
 *
 *   npm run razorpay:create-plans              # dry run: prints what it would create
 *   npm run razorpay:create-plans -- --create  # creates the missing plans
 *
 * Reads RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET from .env.local (an already-set
 * environment variable wins). Test keys (rzp_test_…) create test-mode plans,
 * live keys create live plans. Run against test first.
 *
 * Amounts come from lib/subscription.ts (base price + 18% GST), never retyped.
 * Razorpay plans can't be edited: a price change means new plans, new env ids,
 * and moving existing subscribers over with `subscriptions.update`.
 * Idempotent — a plan with the same name, period and amount is reused.
 */
import fs from "node:fs";
import path from "node:path";

import Razorpay from "razorpay";

import {
  gstPaise,
  subscriptionBasePaise,
  subscriptionChargePaise,
  type BillingInterval,
} from "../lib/subscription";

function loadEnvLocal(): void {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

function rupees(paise: number): string {
  return `₹${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, "0")}`;
}

const PLANS: { interval: BillingInterval; env: string; period: "monthly" | "yearly"; name: string }[] = [
  { interval: "monthly", env: "RAZORPAY_PLAN_STARTER_MONTHLY", period: "monthly", name: "AwaazOS Starter (monthly)" },
  { interval: "yearly", env: "RAZORPAY_PLAN_STARTER_YEARLY", period: "yearly", name: "AwaazOS Starter (yearly)" },
];

async function main(): Promise<void> {
  loadEnvLocal();
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    console.error("RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set (.env.local or environment).");
    process.exit(1);
  }
  const create = process.argv.includes("--create");
  const mode = keyId.startsWith("rzp_live_") ? "LIVE" : "test";
  console.log(`Razorpay ${mode} mode (key ${keyId.slice(0, 9)}…)${create ? "" : " — dry run, pass --create to create"}\n`);

  const rz = new Razorpay({ key_id: keyId, key_secret: keySecret });
  const existing = (await rz.plans.all({ count: 100 })).items;

  const lines: string[] = [];
  for (const p of PLANS) {
    const base = subscriptionBasePaise("STARTER", p.interval);
    const amount = subscriptionChargePaise("STARTER", p.interval);
    const description = `${rupees(base)} + 18% GST (${rupees(gstPaise(base))})`;

    const match = existing.find(
      (e) =>
        e.item.name === p.name &&
        e.period === p.period &&
        e.interval === 1 &&
        Number(e.item.amount) === amount &&
        e.item.currency === "INR",
    );
    if (match) {
      console.log(`exists   ${p.name}: ${rupees(amount)} → ${match.id}`);
      lines.push(`${p.env}=${match.id}`);
      continue;
    }
    if (!create) {
      console.log(`missing  ${p.name}: would create ${rupees(amount)} (${description}), period ${p.period}`);
      continue;
    }
    const plan = await rz.plans.create({
      period: p.period,
      interval: 1,
      item: { name: p.name, amount, currency: "INR", description },
      notes: { plan: "STARTER", interval: p.interval },
    });
    console.log(`created  ${p.name}: ${rupees(amount)} → ${plan.id}`);
    lines.push(`${p.env}=${plan.id}`);
  }

  if (lines.length > 0) {
    console.log(`\nSet these in Vercel (${mode === "LIVE" ? "Production" : "Preview/Development"}) and .env.local:\n`);
    for (const l of lines) console.log(l);
  }
}

main().catch((err: unknown) => {
  const e = err as { statusCode?: number; error?: { description?: string } };
  console.error("Failed:", e.error?.description ?? (err instanceof Error ? err.message : err));
  process.exit(1);
});

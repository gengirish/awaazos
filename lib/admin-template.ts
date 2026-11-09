/**
 * Fills the {token}s in an admin message template from content/admin-nudges/
 * (the heartbeat's Nudge, the leak map's Remind). Pure and client-safe.
 *
 * - `{firstName}`: the owner's first name. When unknown it takes the space
 *   before it along ("Hi {firstName}," → "Hi,"), as in lib/demo-pipeline.ts.
 * - `{senderName}`: the sending admin's first name, else "the team".
 * - every key of `values`: replaced as given.
 *
 * Unknown tokens stay as typed, so a typo in the file shows up in the message
 * instead of vanishing.
 */
import { firstName as firstNameOf } from "@/lib/outreach-message";

export function fillAdminTemplate(
  template: string,
  vars: { firstName: string | null; senderName: string | null; values: Record<string, string> },
): string {
  const first = firstNameOf(vars.firstName);
  let out = template
    .trim()
    .replace(/ ?\{firstName\}/g, (m) => (first ? m.replace("{firstName}", first) : ""))
    .replace(/\{senderName\}/g, firstNameOf(vars.senderName) || "the team");
  for (const [key, value] of Object.entries(vars.values)) {
    out = out.split(`{${key}}`).join(value);
  }
  return out;
}

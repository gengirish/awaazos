/** The browser's calls to the outreach pipeline routes, with one error shape. */
import type { PipelineAction, PipelineActionResult } from "@/lib/demo-pipeline-server";

const ERROR_TEXT: Record<string, string> = {
  not_a_demo_store: "This store has been claimed, so it can't be changed here.",
  not_found: "This demo store no longer exists. Refresh the page.",
  email_required: "Save the seller's email first: the claim link goes to it.",
  has_real_orders: "This store has real orders, so keep it and archive the other one.",
  undo_stale: "Too late to undo: something else has changed on this store.",
};

export class PipelineApiError extends Error {}

async function send<T>(url: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new PipelineApiError("No connection. Try again.");
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string; data?: T } & T;
  if (!res.ok) throw new PipelineApiError(ERROR_TEXT[body.error ?? ""] ?? "That didn't work. Try again.");
  return body.data ?? body;
}

const JSON_POST = { method: "POST", headers: { "Content-Type": "application/json" } };
const storeBase = (ref: string) => `/api/admin/demo-stores/${encodeURIComponent(ref)}`;

// Actions with defaults may leave them out here; the route's schema fills them in.
type ActionInput = { action: PipelineAction["action"] } & Partial<Omit<PipelineAction, "action">> &
  Record<string, unknown>;

export function postPipelineAction(ref: string, body: ActionInput): Promise<PipelineActionResult> {
  return send(`${storeBase(ref)}/pipeline`, { ...JSON_POST, body: JSON.stringify(body) });
}

export function deleteStore(ref: string): Promise<{ event_id?: string }> {
  return send(storeBase(ref), { method: "DELETE" });
}

export function bulkArchive(refs: string[]): Promise<{
  succeeded: { ref: string; event_id?: string }[];
  failed: { ref: string; error: string }[];
}> {
  return send("/api/admin/demo-stores/pipeline/bulk", {
    ...JSON_POST,
    body: JSON.stringify({ refs, action: "archive" }),
  });
}

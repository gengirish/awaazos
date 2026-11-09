/**
 * How a counter sale was built, for `Transaction.source` (pure, client-safe).
 *
 * VOICE when at least one line in the cart at checkout was added by voice
 * (its menu item id is in the cart store's `voiceAddedIds`), otherwise MANUAL.
 * The till never posts any other source.
 */

export type CounterSaleSource = "VOICE" | "MANUAL";

export function counterSaleSource(
  lines: readonly { menuItemId?: string }[],
  voiceAddedIds: readonly string[],
): CounterSaleSource {
  if (voiceAddedIds.length === 0) return "MANUAL";
  const voice = new Set(voiceAddedIds);
  return lines.some((l) => l.menuItemId !== undefined && voice.has(l.menuItemId)) ? "VOICE" : "MANUAL";
}

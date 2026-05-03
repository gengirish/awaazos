/**
 * Provider-agnostic driver for golden parse-order tests.
 *
 * Today: claude-haiku and claude-sonnet are wired (they share the existing
 * `parseOrderWithClaude` + the Anthropic SDK singletons in `lib/anthropic.ts`).
 *
 * Tomorrow: groq-llama and gemini-flash are stubbed. Each stub throws a
 * specific "not implemented" error so the runner can SKIP that provider with
 * a useful message. Wiring a new provider = filling in one function below.
 *
 * The driver intentionally re-uses the production Anthropic code path (not
 * a copy) so any prompt/tool-schema drift in production is automatically
 * caught by the golden run.
 */

import {
  ANTHROPIC_FALLBACK_MODEL,
  ANTHROPIC_PRIMARY_MODEL,
  anthropicHaiku,
  anthropicSonnet,
  parseOrderWithClaude,
  type MenuItemForParse,
  type ParseOrderResult,
} from "@/lib/anthropic";

export type ParseProvider =
  | "claude-haiku"
  | "claude-sonnet"
  | "groq-llama"
  | "gemini-flash";

export interface ProviderRunResult {
  provider: ParseProvider;
  modelName: string;
  latencyMs: number;
  result: ParseOrderResult;
}

export class ProviderNotImplementedError extends Error {
  constructor(public readonly provider: ParseProvider) {
    super(`Provider "${provider}" is not yet wired into the golden harness.`);
    this.name = "ProviderNotImplementedError";
  }
}

type Dispatcher = (
  menu: MenuItemForParse[],
  transcript: string,
  lang: string,
) => Promise<{ result: ParseOrderResult; modelName: string }>;

const claudeHaikuDispatcher: Dispatcher = async (menu, transcript, lang) => {
  const result = await parseOrderWithClaude(
    anthropicHaiku,
    ANTHROPIC_PRIMARY_MODEL,
    menu,
    transcript,
    lang,
  );
  return { result, modelName: ANTHROPIC_PRIMARY_MODEL };
};

const claudeSonnetDispatcher: Dispatcher = async (menu, transcript, lang) => {
  const result = await parseOrderWithClaude(
    anthropicSonnet,
    ANTHROPIC_FALLBACK_MODEL,
    menu,
    transcript,
    lang,
  );
  return { result, modelName: ANTHROPIC_FALLBACK_MODEL };
};

// Stubs — calling these throws ProviderNotImplementedError. The runner
// catches that and reports the provider as SKIPPED rather than FAILED, so a
// run that includes "groq-llama" doesn't false-fail before the integration
// is wired.

const groqLlamaDispatcher: Dispatcher = async () => {
  throw new ProviderNotImplementedError("groq-llama");
};

const geminiFlashDispatcher: Dispatcher = async () => {
  throw new ProviderNotImplementedError("gemini-flash");
};

const dispatchers: Record<ParseProvider, Dispatcher> = {
  "claude-haiku": claudeHaikuDispatcher,
  "claude-sonnet": claudeSonnetDispatcher,
  "groq-llama": groqLlamaDispatcher,
  "gemini-flash": geminiFlashDispatcher,
};

export const ALL_PROVIDERS = Object.keys(dispatchers) as ParseProvider[];

export const IMPLEMENTED_PROVIDERS: ParseProvider[] = [
  "claude-haiku",
  "claude-sonnet",
];

export function isImplemented(p: ParseProvider): boolean {
  return IMPLEMENTED_PROVIDERS.includes(p);
}

export async function dispatchProvider(
  provider: ParseProvider,
  menu: MenuItemForParse[],
  transcript: string,
  lang: string,
): Promise<ProviderRunResult> {
  const dispatcher = dispatchers[provider];
  const t0 = Date.now();
  const { result, modelName } = await dispatcher(menu, transcript, lang);
  return {
    provider,
    modelName,
    latencyMs: Date.now() - t0,
    result,
  };
}

/**
 * Resolve the providers to run from environment variables.
 *
 * Priority:
 *   1. GOLDEN_PARSE_ORDER_PROVIDERS = comma-separated list (overrides single)
 *   2. GOLDEN_PARSE_ORDER_PROVIDER  = single provider name
 *   3. default = "claude-haiku"
 *
 * Unknown provider names are silently dropped with a warning.
 */
export function resolveProvidersFromEnv(
  defaultProviders: ParseProvider[] = ["claude-haiku"],
): ParseProvider[] {
  const list = process.env.GOLDEN_PARSE_ORDER_PROVIDERS;
  const single = process.env.GOLDEN_PARSE_ORDER_PROVIDER;
  let raw: string[];

  if (list && list.trim()) raw = list.split(",").map((s) => s.trim());
  else if (single && single.trim()) raw = [single.trim()];
  else return defaultProviders;

  const known = new Set<string>(ALL_PROVIDERS);
  return raw.filter((s): s is ParseProvider => known.has(s));
}

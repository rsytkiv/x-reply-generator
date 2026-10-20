export const MODELS = {
    "claude-haiku-5-5": { label: "Claude Haiku 5.5 (default, cheapest)", supportsEffort: true },
    "claude-haiku-4-5": { label: "Claude Haiku 4.5", supportsEffort: false },
} as const;

export type ModelId = keyof typeof MODELS;

export const DEFAULT_MODEL: ModelId = "claude-haiku-5-5";

/** Bump when the base rules or DEFAULT_STYLE in src/prompt/system.ts change. A test checks this against the prompt hash. */
export const PROMPT_VERSION = 11;
/** Bump when postprocess rules or the user-message format change. */
export const STYLE_VERSION = 4;

export const GENERATION = {
    maxTokens: 200,
    effort: "medium",
    thinking: "disabled",
    timeoutMs: 20_000,
    maxRetries: 1,
    /** Anthropic prompt caching of the system prompt. Off: saves ~4 cents per 1000 calls at best. */
    promptCaching: false,
} as const;

/** Per reply-length setting: share of plain generations that ask for a 1-4 word reaction, and the word limit. */
export const LENGTH_RULES = {
    short: { shortShare: 0.4, maxWords: 24 },
    medium: { shortShare: 0, maxWords: 45 },
} as const;

/** One-off call that turns a user's description and sample replies into a style guide. */
export const STYLE_GENERATOR = {
    model: "claude-sonnet-5-5",
    effort: "medium",
    maxTokens: 8000,
    timeoutMs: 90_000,
} as const;

export const CACHE = {
    ttlMs: 14 * 24 * 60 * 60 * 1000,
    maxEntries: 300,
    maxVariants: 5,
    /** How many earlier variants go into the prompt on Regenerate. */
    previousInPrompt: 4,
} as const;

/** Replies generated across all posts, sent so the model doesn't repeat itself (not part of the cache key). */
export const RECENT = {
    keep: 10,
    inPrompt: 8,
} as const;

export const STORAGE_KEYS = {
    apiKey: "settings:apiKey",
    model: "settings:model",
    recent: "history:recent",
    style: "settings:style",
} as const;

export const CACHE_PREFIX = "reply:";

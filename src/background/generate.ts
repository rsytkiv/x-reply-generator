import Anthropic from "@anthropic-ai/sdk";
import { GENERATION, LENGTH_RULES, MODELS, type ModelId } from "../config.ts";
import { postprocess } from "../prompt/postprocess.ts";
import { qualityIssue, retryNote, wordCount } from "../prompt/quality.ts";
import { buildSystemPrompt } from "../prompt/system.ts";
import { buildUserMessage } from "../prompt/user-message.ts";
import type { PostContext, ReplyError, StyleSettings } from "../shared/types.ts";

export interface GenerateInput {
    apiKey: string;
    model: ModelId;
    style: StyleSettings;
    ctx: PostContext;
    angle?: string;
    previous?: string[];
    /** Replies made recently on other posts, to avoid repeating the same wording. */
    recent?: string[];
    /** Ask for a 1-4 word reaction this time. */
    short?: boolean;
    /** Set on the one automatic retry after a quality check failed. */
    note?: string;
}

export type Generate = (input: GenerateInput) => Promise<string>;

export class ReplyGenerationError extends Error {
    readonly error: ReplyError;

    constructor(error: ReplyError) {
        super(error.message);
        this.error = error;
    }
}

function fail(code: ReplyError["code"], message: string): never {
    throw new ReplyGenerationError({ code, message });
}

export function buildParams(input: GenerateInput): Anthropic.MessageCreateParamsNonStreaming {
    const prompt = buildSystemPrompt(input.style);
    const system: Anthropic.TextBlockParam[] = [
        GENERATION.promptCaching
            ? { type: "text", text: prompt, cache_control: { type: "ephemeral" } }
            : { type: "text", text: prompt },
    ];
    const params: Anthropic.MessageCreateParamsNonStreaming = {
        model: input.model,
        max_tokens: GENERATION.maxTokens,
        system,
        messages: [{ role: "user", content: buildUserMessage(input.ctx, input) }],
    };
    // Haiku 4.5 has no effort parameter and doesn't think unless asked.
    if (MODELS[input.model].supportsEffort) {
        params.thinking = { type: GENERATION.thinking };
        params.output_config = { effort: GENERATION.effort };
    }
    return params;
}

export function toReplyError(err: unknown): ReplyError {
    if (err instanceof ReplyGenerationError) return err.error;
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        return { code: "bad_key", message: "api key was rejected. check it in settings" };
    }
    if (err instanceof Anthropic.RateLimitError) {
        return { code: "rate_limited", message: "rate limited, try again in a bit" };
    }
    if (err instanceof Anthropic.APIConnectionTimeoutError) {
        return { code: "timeout", message: "the model took too long, try again" };
    }
    if (err instanceof Anthropic.APIConnectionError) {
        return { code: "network", message: "can't reach the api, check your connection" };
    }
    if (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.NotFoundError) {
        return { code: "bad_request", message: `api rejected the request: ${err.message}` };
    }
    if (err instanceof Anthropic.APIError && (err.status === 529 || (err.status ?? 0) >= 500)) {
        return { code: "overloaded", message: "anthropic api is overloaded right now, try again" };
    }
    return { code: "unknown", message: err instanceof Error ? err.message : "something went wrong" };
}

export const generateReply: Generate = async (input) => {
    try {
        const client = new Anthropic({
            apiKey: input.apiKey,
            dangerouslyAllowBrowser: true,
            maxRetries: GENERATION.maxRetries,
            timeout: GENERATION.timeoutMs,
        });
        const response = await client.messages.create(buildParams(input));

        if (response.stop_reason === "refusal") {
            fail("refusal", "the model declined this one. try adding an angle");
        }
        if (response.stop_reason === "max_tokens") {
            fail("truncated", "the reply got cut off, try again");
        }
        const raw = response.content
            .filter((block): block is Anthropic.TextBlock => block.type === "text")
            .map((block) => block.text)
            .join("");
        const text = postprocess(raw, { lowercase: input.style.lowercase });
        if (!text) fail("empty", "the model returned nothing, try again");
        return text;
    } catch (err) {
        throw new ReplyGenerationError(toReplyError(err));
    }
};

/** Cheapest possible call to check the key works. */
export async function testKey(apiKey: string, model: ModelId): Promise<ReplyError | null> {
    try {
        const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 0, timeout: 15_000 });
        await client.messages.create({ model, max_tokens: 5, messages: [{ role: "user", content: "say ok" }] });
        return null;
    } catch (err) {
        return toReplyError(err);
    }
}

/**
 * The generation policy used by the extension and the style eval:
 * - with the "short" length setting, some plain generations ask for a 1-4 word reaction (LENGTH_RULES; the model
 *   alone rarely goes that short);
 * - one normal call, plus at most one retry when the reply fails a quality check. If the retry fails, the first
 *   (valid) reply is kept.
 */
function cleanReplyError(): ReplyGenerationError {
    return new ReplyGenerationError({ code: "empty", message: "couldn't get a clean reply for this one. try regenerate or add an angle" });
}

export function withQualityRetry(generate: Generate, random: () => number = Math.random): Generate {
    return async (rawInput) => {
        const rules = LENGTH_RULES[rawInput.style.length];
        const hasAngle = !!rawInput.angle?.trim();
        const input = { ...rawInput, short: rawInput.short ?? (!hasAngle && random() < rules.shortShare) };
        const checks = { hasAngle, english: input.style.language === "english", maxWords: rules.maxWords };
        const first = await generate(input);
        const issue = qualityIssue(first, { ...checks, recent: input.recent ?? [], short: input.short });
        if (!issue) return first;
        let second: string;
        try {
            second = await generate({ ...input, previous: [...(input.previous ?? []), first], note: retryNote(issue) });
        } catch {
            if (issue === "meta") throw cleanReplyError();
            return first;
        }
        // A reply that talks about prompts or instructions gives away that a bot wrote it: never show it.
        if (qualityIssue(second, checks) === "meta") throw cleanReplyError();
        // Length retries: keep whichever came out shorter.
        if ((issue === "too_long" || issue === "not_short") && wordCount(second) > wordCount(first)) return first;
        return second;
    };
}

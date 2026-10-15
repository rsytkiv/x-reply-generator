import { CACHE, type ModelId } from "../config.ts";
import type { CacheEntry, PostContext, ReplyError, StyleSettings, UiResponse } from "../shared/types.ts";
import { cacheKey, type ReplyCache } from "./cache.ts";
import type { RecentReplies } from "./recent.ts";
import { ReplyGenerationError, type Generate } from "./generate.ts";

export interface Settings {
    apiKey: string;
    model: ModelId;
    style: StyleSettings;
}

function preview(ctx: PostContext): string {
    return `@${ctx.author}: ${ctx.text}`.slice(0, 160);
}

/** Cache-first reply logic with in-flight request sharing. Has no chrome.* dependencies. */
export class ReplyService {
    private pending = new Map<string, Promise<UiResponse>>();

    constructor(
        private cache: ReplyCache,
        private generate: Generate,
        private loadSettings: () => Promise<Settings | null>,
        private recent: RecentReplies,
    ) {}

    /** Cached reply if there is one, otherwise a new generation. */
    get(ctx: PostContext, angle?: string): Promise<UiResponse> {
        return this.run(ctx, angle, false);
    }

    /** Always calls the API and adds a new variant. */
    regenerate(ctx: PostContext, angle?: string): Promise<UiResponse> {
        return this.run(ctx, angle, true);
    }

    async select(ctx: PostContext, angle: string | undefined, index: number): Promise<UiResponse> {
        const settings = await this.loadSettings();
        if (!settings) return noKey();
        const key = await cacheKey(ctx, angle, settings.model, settings.style);
        const entry = await this.cache.select(key, index);
        if (!entry) return { type: "error", error: { code: "unknown", message: "this reply expired, generate again" } };
        return { type: "result", entry, fromCache: true };
    }

    private async run(ctx: PostContext, angle: string | undefined, force: boolean): Promise<UiResponse> {
        const settings = await this.loadSettings();
        if (!settings) return noKey();

        const key = await cacheKey(ctx, angle, settings.model, settings.style);
        const pendingKey = force ? `${key}:regen` : key;
        const inFlight = this.pending.get(pendingKey);
        if (inFlight) return inFlight;

        const task = this.produce(key, ctx, angle, force, settings).finally(() => {
            this.pending.delete(pendingKey);
        });
        this.pending.set(pendingKey, task);
        return task;
    }

    private async produce(
        key: string,
        ctx: PostContext,
        angle: string | undefined,
        force: boolean,
        settings: Settings,
    ): Promise<UiResponse> {
        const cached = await this.cache.get(key);
        if (cached && !force) return { type: "result", entry: cached, fromCache: true };

        // A plain "get" can arrive while a regenerate for the same key runs; wait for it instead of a 2nd call.
        if (!force) {
            const regen = this.pending.get(`${key}:regen`);
            if (regen) return regen;
        }

        const previous = (cached?.variants ?? []).slice(-CACHE.previousInPrompt).map((v) => v.text);
        // Replies on other posts. This post's own variants already go in as `previous`.
        const recent = (await this.recent.forPrompt()).filter((t) => !previous.includes(t));
        try {
            const text = await this.generate({ apiKey: settings.apiKey, model: settings.model, style: settings.style, ctx, angle, previous, recent });
            const entry: CacheEntry = await this.cache.addVariant(key, ctx.postId, preview(ctx), text);
            await this.recent.push(text);
            return { type: "result", entry, fromCache: false };
        } catch (err) {
            const error: ReplyError =
                err instanceof ReplyGenerationError
                    ? err.error
                    : { code: "unknown", message: err instanceof Error ? err.message : "something went wrong" };
            return { type: "error", error };
        }
    }
}

function noKey(): UiResponse {
    return { type: "error", error: { code: "no_key", message: "add your anthropic api key in settings first" } };
}

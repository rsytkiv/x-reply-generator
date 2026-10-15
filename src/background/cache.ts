import { CACHE, CACHE_PREFIX, GENERATION, STYLE_VERSION } from "../config.ts";
import { buildSystemPrompt } from "../prompt/system.ts";
import { normalize, sha256 } from "../shared/hash.ts";
import type { CacheEntry, PostContext, StyleSettings } from "../shared/types.ts";
import type { KeyValueStore } from "./storage.ts";

/**
 * Everything that changes the model's answer goes into the key. The style part is a hash of the full system
 * prompt, so editing the style (or the built-in rules) never brings back a reply made with the old one.
 */
export async function cacheKey(
    ctx: PostContext,
    angle: string | undefined,
    model: string,
    style: StyleSettings,
    styleVersion: number = STYLE_VERSION,
): Promise<string> {
    const context = JSON.stringify({
        text: normalize(ctx.text),
        author: ctx.author,
        truncated: ctx.truncated,
        media: ctx.media,
        link: ctx.link ?? null,
        quoted: ctx.quoted ? { ...ctx.quoted, text: normalize(ctx.quoted.text) } : null,
        parent: ctx.parent ? { ...ctx.parent, text: normalize(ctx.parent.text) } : null,
        replyingTo: ctx.replyingTo ?? null,
    });
    return sha256(
        JSON.stringify({
            postId: ctx.postId,
            contextHash: await sha256(context),
            angle: normalize(angle) || null,
            model,
            maxTokens: GENERATION.maxTokens,
            effort: GENERATION.effort,
            thinking: GENERATION.thinking,
            systemPrompt: await sha256(buildSystemPrompt(style)),
            length: style.length,
            lowercase: style.lowercase,
            styleVersion,
        }),
    );
}

export class ReplyCache {
    constructor(
        private store: KeyValueStore,
        private now: () => number = Date.now,
    ) {}

    /** Returns a fresh entry and marks it as used, or null on miss/expired. */
    async get(key: string): Promise<CacheEntry | null> {
        const id = CACHE_PREFIX + key;
        const entry = (await this.store.get(id))[id] as CacheEntry | undefined;
        if (!entry) return null;
        if (this.isExpired(entry)) {
            await this.store.remove(id);
            return null;
        }
        entry.lastUsedAt = this.now();
        await this.store.set({ [id]: entry });
        return entry;
    }

    /** Appends a new variant (creating the entry if needed) and selects it. */
    async addVariant(key: string, postId: string, preview: string, text: string): Promise<CacheEntry> {
        const id = CACHE_PREFIX + key;
        const now = this.now();
        const existing = (await this.store.get(id))[id] as CacheEntry | undefined;
        const entry: CacheEntry =
            existing && !this.isExpired(existing)
                ? existing
                : { postId, preview, variants: [], selected: 0, createdAt: now, lastUsedAt: now };

        entry.variants.push({ text, createdAt: now });
        if (entry.variants.length > CACHE.maxVariants) {
            entry.variants.splice(0, entry.variants.length - CACHE.maxVariants);
        }
        entry.selected = entry.variants.length - 1;
        entry.lastUsedAt = now;

        await this.store.set({ [id]: entry });
        await this.evict();
        return entry;
    }

    async select(key: string, index: number): Promise<CacheEntry | null> {
        const entry = await this.get(key);
        if (!entry) return null;
        entry.selected = Math.max(0, Math.min(index, entry.variants.length - 1));
        await this.store.set({ [CACHE_PREFIX + key]: entry });
        return entry;
    }

    /** Drops expired entries, then the least recently used ones above the limit. */
    async evict(): Promise<void> {
        const entries = await this.all();
        const expired = entries.filter(([, e]) => this.isExpired(e)).map(([id]) => id);
        const alive = entries.filter(([, e]) => !this.isExpired(e));
        const overflow = alive.length - CACHE.maxEntries;
        const lru =
            overflow > 0
                ? alive
                      .sort(([, a], [, b]) => a.lastUsedAt - b.lastUsedAt)
                      .slice(0, overflow)
                      .map(([id]) => id)
                : [];
        const toRemove = [...expired, ...lru];
        if (toRemove.length) await this.store.remove(toRemove);
    }

    async count(): Promise<number> {
        return (await this.all()).length;
    }

    async clear(): Promise<void> {
        const ids = (await this.all()).map(([id]) => id);
        if (ids.length) await this.store.remove(ids);
    }

    private async all(): Promise<[string, CacheEntry][]> {
        const everything = await this.store.get(null);
        return Object.entries(everything).filter(([id]) => id.startsWith(CACHE_PREFIX)) as [string, CacheEntry][];
    }

    private isExpired(entry: CacheEntry): boolean {
        return this.now() - entry.lastUsedAt > CACHE.ttlMs;
    }
}

import { describe, expect, it, vi } from "vitest";
import { CACHE } from "../src/config.ts";
import { cacheKey, ReplyCache } from "../src/background/cache.ts";
import { ReplyGenerationError, type Generate } from "../src/background/generate.ts";
import { ReplyService } from "../src/background/service.ts";
import { RecentReplies } from "../src/background/recent.ts";
import { memoryStore } from "../src/background/storage.ts";
import { DEFAULT_STYLE_SETTINGS } from "../src/shared/style-settings.ts";
import type { PostContext } from "../src/shared/types.ts";

const post: PostContext = { postId: "100", author: "dev", text: "microservices are overrated", truncated: false, media: [] };
const settings = { apiKey: "sk-ant-test", model: "claude-haiku-5-5" as const, style: DEFAULT_STYLE_SETTINGS };

function setup(generate?: Generate, now = () => 1_000) {
    const store = memoryStore();
    const cache = new ReplyCache(store, now);
    let n = 0;
    const gen = vi.fn<Generate>(generate ?? (async () => `reply ${++n}`));
    const recent = new RecentReplies(store);
    const service = new ReplyService(cache, gen, async () => settings, recent);
    return { store, cache, gen, service, recent };
}

describe("ReplyService cache", () => {
    it("generates once, then serves the saved reply without an API call", async () => {
        const { gen, service } = setup();
        const first = await service.get(post);
        const second = await service.get(post);
        expect(gen).toHaveBeenCalledTimes(1);
        expect(first).toMatchObject({ type: "result", fromCache: false });
        expect(second).toMatchObject({ type: "result", fromCache: true });
        if (second.type === "result") expect(second.entry.variants.map((v) => v.text)).toEqual(["reply 1"]);
    });

    it("survives a 'restart': a new service over the same storage still hits", async () => {
        const { store, gen } = setup();
        await new ReplyService(new ReplyCache(store), gen, async () => settings, new RecentReplies(store)).get(post);
        const fresh = new ReplyService(new ReplyCache(store), gen, async () => settings, new RecentReplies(store));
        expect(await fresh.get(post)).toMatchObject({ fromCache: true });
        expect(gen).toHaveBeenCalledTimes(1);
    });

    it("regenerate bypasses the cache, sends earlier variants and keeps all of them", async () => {
        const { gen, service } = setup();
        await service.get(post);
        const res = await service.regenerate(post);
        expect(gen).toHaveBeenCalledTimes(2);
        expect(gen.mock.calls[1]?.[0].previous).toEqual(["reply 1"]);
        expect(res.type === "result" && res.entry).toMatchObject({ selected: 1, variants: [{ text: "reply 1" }, { text: "reply 2" }] });
        // Next open shows the newest variant from cache.
        const again = await service.get(post);
        expect(again.type === "result" && again.entry.selected).toBe(1);
        expect(gen).toHaveBeenCalledTimes(2);
    });

    it("select switches to an earlier variant without generating", async () => {
        const { gen, service } = setup();
        await service.get(post);
        await service.regenerate(post);
        const res = await service.select(post, undefined, 0);
        expect(res.type === "result" && res.entry.selected).toBe(0);
        expect(gen).toHaveBeenCalledTimes(2);
    });

    it("keeps at most maxVariants variants", async () => {
        const { service } = setup();
        await service.get(post);
        for (let i = 0; i < CACHE.maxVariants + 2; i++) await service.regenerate(post);
        const res = await service.get(post);
        expect(res.type === "result" && res.entry.variants).toHaveLength(CACHE.maxVariants);
    });

    it.each<[string, PostContext, string | undefined]>([
        ["post text", { ...post, text: "microservices are underrated" }, undefined],
        ["parent", { ...post, parent: { author: "op", text: "thoughts?" } }, undefined],
        ["quote", { ...post, quoted: { author: "q", text: "x", media: [] } }, undefined],
        ["media", { ...post, media: ["image"] }, undefined],
        ["angle", post, "agree but mention costs"],
    ])("a different %s means a new generation", async (_name, changed, angle) => {
        const { gen, service } = setup();
        await service.get(post);
        await service.get(changed, angle);
        expect(gen).toHaveBeenCalledTimes(2);
    });

    it("ignores whitespace-only differences in text and angle", async () => {
        const { gen, service } = setup();
        await service.get(post, "agree");
        await service.get({ ...post, text: `  ${post.text.replace(" ", "\n ")} ` }, " agree ");
        expect(gen).toHaveBeenCalledTimes(1);
    });

    it("a different model, style, language, length, case or version changes the key", async () => {
        const base = await cacheKey(post, undefined, "claude-haiku-5-5", DEFAULT_STYLE_SETTINGS);
        const variants = [
            cacheKey(post, undefined, "claude-haiku-4-5", DEFAULT_STYLE_SETTINGS),
            cacheKey(post, undefined, "claude-haiku-5-5", { ...DEFAULT_STYLE_SETTINGS, stylePrompt: "be sarcastic" }),
            cacheKey(post, undefined, "claude-haiku-5-5", { ...DEFAULT_STYLE_SETTINGS, language: "ukrainian" }),
            cacheKey(post, undefined, "claude-haiku-5-5", { ...DEFAULT_STYLE_SETTINGS, length: "medium" }),
            cacheKey(post, undefined, "claude-haiku-5-5", { ...DEFAULT_STYLE_SETTINGS, lowercase: false }),
            cacheKey(post, undefined, "claude-haiku-5-5", DEFAULT_STYLE_SETTINGS, 999),
        ];
        for (const key of await Promise.all(variants)) expect(key).not.toBe(base);
    });

    it("a saved style change means a new generation for a post seen before", async () => {
        const store = memoryStore();
        const gen = vi.fn<Generate>(async () => "fresh");
        let style = DEFAULT_STYLE_SETTINGS;
        const service = new ReplyService(new ReplyCache(store), gen, async () => ({ ...settings, style }), new RecentReplies(store));
        await service.get(post);
        style = { ...DEFAULT_STYLE_SETTINGS, stylePrompt: "be sarcastic" };
        expect(await service.get(post)).toMatchObject({ fromCache: false });
        expect(gen).toHaveBeenCalledTimes(2);
        expect(gen.mock.calls[1]?.[0].style.stylePrompt).toBe("be sarcastic");
    });
});

describe("in-flight dedup", () => {
    it("parallel gets for the same post share one API call", async () => {
        let release!: (v: string) => void;
        const { gen, service } = setup(() => new Promise((r) => (release = r)));
        const a = service.get(post);
        const b = service.get(post);
        await vi.waitFor(() => expect(gen).toHaveBeenCalledTimes(1));
        release("shared");
        const [ra, rb] = await Promise.all([a, b]);
        expect(gen).toHaveBeenCalledTimes(1);
        expect(ra).toEqual(rb);
    });

    it("double-clicking regenerate makes one call", async () => {
        // Like the real API, the call takes a while, so the second click lands while it runs.
        const { gen, service } = setup(() => new Promise((r) => setTimeout(() => r("slow"), 30)));
        await service.get(post);
        await Promise.all([service.regenerate(post), service.regenerate(post)]);
        expect(gen).toHaveBeenCalledTimes(2);
    });

    it("a get during a running regenerate waits for it instead of calling again", async () => {
        const { gen, service } = setup(() => new Promise((r) => setTimeout(() => r("slow"), 30)));
        await service.get(post);
        const regen = service.regenerate(post);
        await vi.waitFor(() => expect(gen).toHaveBeenCalledTimes(2));
        await service.get(post);
        await regen;
        expect(gen).toHaveBeenCalledTimes(2);
    });

    it("after a call finishes, the next regenerate makes a new call", async () => {
        const { gen, service } = setup();
        await service.regenerate(post);
        await service.regenerate(post);
        expect(gen).toHaveBeenCalledTimes(2);
    });
});

describe("errors are not cached", () => {
    it.each(["refusal", "truncated", "rate_limited", "network"] as const)("%s", async (code) => {
        let fail = true;
        const { gen, service, cache } = setup(async () => {
            if (fail) throw new ReplyGenerationError({ code, message: code });
            return "ok now";
        });
        expect(await service.get(post)).toMatchObject({ type: "error", error: { code } });
        expect(await cache.count()).toBe(0);
        fail = false;
        expect(await service.get(post)).toMatchObject({ type: "result", fromCache: false });
        expect(gen).toHaveBeenCalledTimes(2);
    });

    it("asks for a key when none is saved", async () => {
        const gen = vi.fn<Generate>();
        const store = memoryStore();
        const service = new ReplyService(new ReplyCache(store), gen, async () => null, new RecentReplies(store));
        expect(await service.get(post)).toMatchObject({ type: "error", error: { code: "no_key" } });
        expect(gen).not.toHaveBeenCalled();
    });
});

describe("TTL and LRU", () => {
    it("expired entries are a miss", async () => {
        let now = 1_000;
        const { gen, service } = setup(undefined, () => now);
        await service.get(post);
        now += CACHE.ttlMs + 1;
        expect(await service.get(post)).toMatchObject({ fromCache: false });
        expect(gen).toHaveBeenCalledTimes(2);
    });

    it("evicts the least recently used entries above the limit", async () => {
        let now = 0;
        const store = memoryStore();
        const cache = new ReplyCache(store, () => now);
        for (let i = 0; i < CACHE.maxEntries; i++) {
            now = i + 1;
            await cache.addVariant(`k${i}`, String(i), "", "r");
        }
        now += 1;
        await cache.get("k0"); // k0 is now the most recently used
        now += 1;
        await cache.addVariant("new", "new", "", "r");
        expect(await cache.count()).toBe(CACHE.maxEntries);
        expect(await cache.get("k0")).not.toBeNull();
        expect(await cache.get("k1")).toBeNull();
    });

    it("clear removes only reply entries", async () => {
        const store = memoryStore({ "settings:apiKey": "sk-ant-x" });
        const cache = new ReplyCache(store);
        await cache.addVariant("a", "1", "", "r");
        await cache.clear();
        expect(await cache.count()).toBe(0);
        expect(await store.get("settings:apiKey")).toEqual({ "settings:apiKey": "sk-ant-x" });
    });
});

describe("recent replies across posts", () => {
    const other: PostContext = { ...post, postId: "200", text: "looking to connect with saas builders" };
    const third: PostContext = { ...post, postId: "300", text: "who's building in public? let's connect" };

    it("sends replies from other posts so the model can vary its wording", async () => {
        const { gen, service } = setup();
        await service.get(post);
        await service.get(other);
        await service.get(third);
        expect(gen.mock.calls[0]?.[0].recent).toEqual([]);
        expect(gen.mock.calls[2]?.[0].recent).toEqual(["reply 1", "reply 2"]);
    });

    it("doesn't repeat this post's own variants in recent (they go in previous)", async () => {
        const { gen, service } = setup();
        await service.get(post);
        await service.get(other);
        await service.regenerate(post);
        expect(gen.mock.calls[2]?.[0].previous).toEqual(["reply 1"]);
        expect(gen.mock.calls[2]?.[0].recent).toEqual(["reply 2"]);
    });

    it("keeps only the last few, and cache hits don't add duplicates", async () => {
        const { recent, service } = setup();
        for (let i = 0; i < 15; i++) await service.get({ ...post, postId: String(i) });
        await service.get({ ...post, postId: "14" });
        const list = await recent.list();
        expect(list).toHaveLength(10);
        expect(list.at(-1)).toBe("reply 15");
        expect(new Set(list).size).toBe(list.length);
    });

    it("recent history doesn't change the cache key", async () => {
        const { gen, service } = setup();
        await service.get(post);
        await service.get(other);
        await service.get(post);
        expect(gen).toHaveBeenCalledTimes(2);
    });
});

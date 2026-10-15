import { DEFAULT_MODEL, MODELS, STORAGE_KEYS, type ModelId } from "../config.ts";
import { normalize, sha256 } from "../shared/hash.ts";
import { normalizeStyle, styleFromStorage } from "../shared/style-settings.ts";
import { PORT_NAME, type PostContext, type RuntimeMessage, type UiRequest, type UiResponse } from "../shared/types.ts";
import { ReplyCache } from "./cache.ts";
import { generateReply, ReplyGenerationError, testKey, toReplyError, withQualityRetry } from "./generate.ts";
import { RecentReplies } from "./recent.ts";
import { ReplyService, type Settings } from "./service.ts";
import { generateStyle } from "./style-generator.ts";

const store = chrome.storage.local;
const cache = new ReplyCache(store);

async function loadSettings(): Promise<Settings | null> {
    const data = await store.get([STORAGE_KEYS.apiKey, STORAGE_KEYS.model, STORAGE_KEYS.style]);
    const apiKey = data[STORAGE_KEYS.apiKey];
    if (typeof apiKey !== "string" || !apiKey) return null;
    const model = data[STORAGE_KEYS.model];
    return {
        apiKey,
        model: typeof model === "string" && model in MODELS ? (model as ModelId) : DEFAULT_MODEL,
        style: styleFromStorage(data),
    };
}

const generate = withQualityRetry(generateReply);

function errorMessage(err: unknown): string {
    return err instanceof ReplyGenerationError ? err.error.message : toReplyError(err).message;
}

const recent = new RecentReplies(store);
const service = new ReplyService(cache, generate, loadSettings, recent);

/** Keep the API key and cache out of reach of content scripts. */
async function lockStorage(): Promise<void> {
    await store.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
}

chrome.runtime.onInstalled.addListener((details) => {
    void lockStorage();
    void cache.evict();
    // First install: the extension does nothing without a key, so go straight to settings.
    if (details.reason === "install") void chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(() => {
    void lockStorage();
    void cache.evict();
});
void lockStorage();

// The UI talks over a port: an open port keeps the service worker alive while the API call runs.
chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== PORT_NAME) return;
    let open = true;
    port.onDisconnect.addListener(() => {
        open = false;
    });
    port.onMessage.addListener(async (msg: UiRequest & { id: number }) => {
        let response: UiResponse;
        if (msg.type === "get") response = await service.get(msg.ctx, msg.angle);
        else if (msg.type === "regenerate") response = await service.regenerate(msg.ctx, msg.angle);
        else response = await service.select(msg.ctx, msg.angle, msg.index);
        if (open) port.postMessage({ ...response, id: msg.id });
    });
});

chrome.runtime.onMessage.addListener((msg: RuntimeMessage, sender, sendResponse) => {
    // Only our own pages (options, popup) may use these. Content scripts run on x.com URLs.
    const fromExtensionPage = sender.id === chrome.runtime.id && !!sender.url?.startsWith(chrome.runtime.getURL(""));
    if (!fromExtensionPage && msg.type !== "open-options") return false;
    (async () => {
        if (msg.type === "test-key") {
            const settings = await loadSettings();
            if (!settings) return { ok: false, message: "no key saved" };
            const error = await testKey(settings.apiKey, settings.model);
            return error ? { ok: false, message: error.message } : { ok: true };
        }
        if (msg.type === "generate-style") {
            const settings = await loadSettings();
            if (!settings) return { ok: false, message: "save your api key first" };
            try {
                const style = await generateStyle({ apiKey: settings.apiKey, ...msg });
                return { ok: true, style };
            } catch (err) {
                return { ok: false, message: errorMessage(err) };
            }
        }
        if (msg.type === "preview") {
            // Try a style before saving it: one reply, no cache, no history.
            const settings = await loadSettings();
            if (!settings) return { ok: false, message: "save your api key first" };
            const text = normalize(msg.text);
            if (!text) return { ok: false, message: "paste a post to try it on" };
            const ctx: PostContext = {
                postId: `preview:${(await sha256(text)).slice(0, 16)}`,
                author: "someone",
                text: msg.text.trim(),
                truncated: false,
                media: [],
            };
            try {
                const reply = await generate({ apiKey: settings.apiKey, model: settings.model, style: normalizeStyle(msg.style), ctx });
                return { ok: true, reply };
            } catch (err) {
                return { ok: false, message: errorMessage(err) };
            }
        }
        if (msg.type === "cache-stats") return { count: await cache.count() };
        if (msg.type === "cache-clear") {
            await cache.clear();
            await recent.clear();
            return { count: 0 };
        }
        if (msg.type === "open-options") {
            await chrome.runtime.openOptionsPage();
            return { ok: true };
        }
        return null;
    })().then(sendResponse);
    return true;
});

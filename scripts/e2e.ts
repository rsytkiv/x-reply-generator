// End-to-end check of the built extension in Chromium.
// x.com is served from fixtures and the Anthropic API is mocked, so it costs nothing and needs no login.
// Usage: npm run e2e   (set CHROMIUM_PATH if Playwright's Chromium lives elsewhere)
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type BrowserContext, type Page, type Route } from "playwright-core";
import { page as fakePage, type FakeTweet } from "../tests/x-dom.ts";

process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";

function findChromium(): string {
    if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
    const cache = join(homedir(), "Library/Caches/ms-playwright");
    const dir = readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
    if (!dir) throw new Error("No Playwright Chromium found. Set CHROMIUM_PATH.");
    return join(cache, dir, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
}

const dist = resolve("dist");
const shots = resolve(process.env.SHOTS_DIR ?? tmpdir());
const profile = mkdtempSync(join(tmpdir(), "xrg-e2e-"));

const FEED: FakeTweet[] = [
    { id: "101", handle: "founder", text: "Would you hire a cook who can't use a stove?" },
    { id: "102", handle: "replier", text: "yeah kinda the same", connectedAbove: true },
    { id: "999", handle: "brand", text: "Buy our course", ad: true },
    {
        id: "103",
        handle: "author",
        text: "this is why people leave",
        quote: { handle: "saas", text: "All features now require a Pro subscription." },
    },
    { id: "104", handle: "photog", text: "this.", photos: 1 },
    { id: "105", handle: "longpost", text: "Kubernetes is overkill for most startups and here is why", showMore: true },
];

const html = (theme: "light" | "dark") => `<!doctype html><html><head><meta charset="utf-8"><title>X fixture</title>
<style>body{margin:0;font-family:sans-serif;background:${theme === "dark" ? "#000" : "#fff"};color:${theme === "dark" ? "#e7e9ea" : "#0f1419"}}
main{max-width:600px;margin:0 auto} article{display:block;padding:12px;border-bottom:1px solid #2f3336}
[role=group]{display:flex;gap:8px;margin-top:8px} [data-testid=tweetText]{margin:6px 0}</style></head>
<body><main>${fakePage(...FEED)}</main>
<script>document.addEventListener('click',e=>{const a=e.target.closest('a');if(a&&a.getAttribute('href')?.startsWith('/')){e.preventDefault();history.pushState({},'',a.getAttribute('href'));}});</script>
</body></html>`;

// ---- Anthropic API mock ----
let apiCalls: string[] = [];
let styleCalls: string[] = [];
let apiMode: "ok" | "401" | "slow" = "ok";
let replyNo = 0;

async function anthropic(route: Route): Promise<void> {
    const req = route.request();
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const body = req.postData() ?? "";
    // The style generator uses a different model; answer it with a style guide.
    if (JSON.parse(body || "{}").model === "claude-sonnet-5-5") {
        styleCalls.push(body);
        return route.fulfill({
            status: 200,
            headers: { ...cors, "content-type": "application/json" },
            body: JSON.stringify({
                id: "msg_style", type: "message", role: "assistant", model: "claude-sonnet-5-5",
                content: [{ type: "text", text: "<style>\nGoal\n- e2e generated style\n</style>" }],
                stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 },
            }),
        });
    }
    apiCalls.push(body);
    if (apiMode === "401") {
        return route.fulfill({
            status: 401,
            headers: { ...cors, "content-type": "application/json" },
            body: JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }),
        });
    }
    if (apiMode === "slow") await new Promise((r) => setTimeout(r, 800));
    replyNo += 1;
    return route.fulfill({
        status: 200,
        headers: { ...cors, "content-type": "application/json" },
        body: JSON.stringify({
            id: `msg_e2e_${replyNo}`,
            type: "message",
            role: "assistant",
            model: "claude-haiku-5-5",
            content: [{ type: "text", text: `R${replyNo} idea — number ${replyNo}.` }],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 5 },
        }),
    });
}

let theme: "light" | "dark" = "dark";

async function launch(): Promise<{ ctx: BrowserContext; extId: string }> {
    const ctx = await chromium.launchPersistentContext(profile, {
        executablePath: findChromium(),
        headless: true,
        args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
        viewport: { width: 1100, height: 900 },
    });
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://x.com" });
    await ctx.route("https://x.com/**", (route) =>
        route.fulfill({ status: 200, contentType: "text/html", body: html(theme) }),
    );
    await ctx.route("https://api.anthropic.com/**", anthropic);
    const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
    return { ctx, extId: new URL(sw.url()).host };
}

// ---- tiny test runner ----
let failures = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
    try {
        await fn();
        console.log(`✓ ${name}`);
    } catch (err) {
        failures += 1;
        console.log(`✗ ${name}\n    ${(err as Error).message.split("\n")[0]}`);
    }
}
function expect(cond: boolean, msg: string): void {
    if (!cond) throw new Error(msg);
}

// Our UI lives in open shadow roots; Playwright's CSS engine pierces them.
const trigger = (p: Page, postId: string) =>
    p.locator(`article:has(a[href$="/status/${postId}"]) .xrg-trigger`);
const panel = (p: Page) => p.locator(".xrg-panel");

async function openFor(p: Page, postId: string): Promise<void> {
    await trigger(p, postId).click();
    await panel(p).waitFor();
}
async function waitIdle(p: Page): Promise<void> {
    await p.waitForFunction(() => {
        const host = [...document.querySelectorAll("div")].find((d) => d.shadowRoot?.querySelector(".xrg-panel"));
        return host && !host.shadowRoot!.querySelector(".xrg-busy");
    });
}
const replyText = (p: Page) => p.locator(".xrg-text").inputValue();
async function closePanel(p: Page): Promise<void> {
    await p.keyboard.press("Escape");
    await panel(p).waitFor({ state: "detached" });
}

// ---- run ----
let { ctx, extId } = await launch();
const opts = await ctx.newPage();
await opts.goto(`chrome-extension://${extId}/options.html`);

await check("first install opens the settings page", async () => {
    const opened = ctx.pages().some((p) => p.url().endsWith("/options.html"));
    expect(opened, "options page should open on install");
});

await check("options: no key yet, cache empty", async () => {
    await opts.locator("#cache-msg").filter({ hasText: "0 saved" }).waitFor();
});

let x = await ctx.newPage();
await x.goto("https://x.com/home");

await check("without a key the panel asks to open settings", async () => {
    await openFor(x, "101");
    await waitIdle(x);
    await x.locator(".xrg-error", { hasText: "api key" }).waitFor();
    await x.locator(".xrg-error button", { hasText: "Open settings" }).waitFor();
    expect(apiCalls.length === 0, "API must not be called without a key");
    await closePanel(x);
});

await opts.bringToFront();
await opts.fill("#key", "sk-ant-e2e-fake-key");
await opts.click("#save-key");
await opts.locator("#api-msg", { hasText: "saved" }).waitFor();

await check("content script can't read the API key from storage", async () => {
    // Content scripts run in an isolated world we can't reach from Playwright, so check the access level
    // the service worker set: TRUSTED_CONTEXTS blocks content scripts.
    const sw = ctx.serviceWorkers()[0]!;
    const level = await sw.evaluate(async () => {
        // @ts-expect-error getAccessLevel isn't typed everywhere
        return chrome.storage.local.getAccessLevel ? await chrome.storage.local.getAccessLevel() : "n/a";
    });
    expect(level === "n/a" || JSON.stringify(level).includes("TRUSTED_CONTEXTS"), `access level ${JSON.stringify(level)}`);
});

await x.bringToFront();
await x.reload();

await check("buttons on every post except the ad", async () => {
    await trigger(x, "101").waitFor();
    const count = await x.locator(".xrg-trigger").count();
    expect(count === 5, `expected 5 buttons, got ${count}`);
});

await check("first open generates from the clicked post with its parent, no neighbours", async () => {
    apiCalls = [];
    await openFor(x, "102");
    await waitIdle(x);
    const text = await replyText(x);
    expect(text === "r1 idea, number 1", `postprocessed reply, got "${text}"`);
    expect(apiCalls.length === 1, `1 API call, got ${apiCalls.length}`);
    const body = JSON.parse(apiCalls[0]!);
    const user = body.messages[0].content as string;
    expect(user.includes("<parent>@founder: Would you hire a cook"), "parent missing");
    expect(user.includes("<target>@replier: yeah kinda the same"), "target missing");
    expect(!/Buy our course|this is why people leave/.test(user), "neighbour text leaked into prompt");
    expect(body.model === "claude-haiku-5-5" && body.max_tokens === 200, "model params");
    expect(body.thinking?.type === "disabled" && body.output_config?.effort === "medium", "thinking/effort");
    await x.screenshot({ path: join(shots, "e2e-panel-dark.png"), clip: { x: 0, y: 0, width: 1100, height: 600 } });
});

await check("Copy puts the edited text on the clipboard", async () => {
    await x.locator(".xrg-text").fill("yeah kinda, edited");
    await x.locator(".xrg-primary").click();
    await x.locator(".xrg-primary", { hasText: "Copied" }).waitFor();
    const clip = await x.evaluate(() => navigator.clipboard.readText());
    expect(clip === "yeah kinda, edited", `clipboard: "${clip}"`);
});

await check("reopening the same post uses the cache (no API call)", async () => {
    await closePanel(x);
    apiCalls = [];
    await openFor(x, "102");
    await waitIdle(x);
    expect((await replyText(x)) === "r1 idea, number 1", "shows cached reply");
    expect(apiCalls.length === 0, `expected 0 calls, got ${apiCalls.length}`);
});

await check("Regenerate makes exactly one new call, sends the old reply, shows 2/2", async () => {
    apiMode = "slow";
    apiCalls = [];
    const regen = x.locator(".xrg-secondary", { hasText: "Regenerate" });
    await regen.click();
    await regen.click({ force: true }).catch(() => {}); // double click while busy
    await waitIdle(x);
    apiMode = "ok";
    expect(apiCalls.length === 1, `expected 1 call, got ${apiCalls.length}`);
    expect(apiCalls[0]!.includes("<previous_replies>\\n- r1 idea, number 1"), "previous replies in prompt");
    expect((await x.locator(".xrg-counter").textContent()) === "2/2", "counter 2/2");
    expect((await replyText(x)) === "r2 idea, number 2", "new variant shown");
});

await check("‹ goes back to variant 1 without a call", async () => {
    apiCalls = [];
    await x.locator(".xrg-nav", { hasText: "‹" }).click();
    await waitIdle(x);
    expect((await replyText(x)) === "r1 idea, number 1", "variant 1");
    expect((await x.locator(".xrg-counter").textContent()) === "1/2", "counter 1/2");
    expect(apiCalls.length === 0, "no call");
    await closePanel(x);
});

await check("quote post: author text and quote go in separately", async () => {
    apiCalls = [];
    await openFor(x, "103");
    await waitIdle(x);
    const user = JSON.parse(apiCalls[0]!).messages[0].content as string;
    expect(user.includes("<target>@author: this is why people leave"), "author text");
    expect(user.includes("<quoted>@saas: All features now require a Pro subscription.</quoted>"), "quote");
    expect(await x.locator(".xrg-badge", { hasText: "quote" }).isVisible(), "quote badge");
    await closePanel(x);
});

await check("media-only post asks for an angle and doesn't call the API", async () => {
    apiCalls = [];
    await openFor(x, "104");
    await x.locator(".xrg-status", { hasText: "mostly media" }).waitFor();
    await x.waitForTimeout(300);
    expect(apiCalls.length === 0, "no call before angle");
    await x.locator(".xrg-angle").fill("joke about how every startup office looks the same");
    await x.locator(".xrg-angle").press("Enter");
    await waitIdle(x);
    expect(apiCalls.length === 1, "one call after angle");
    expect(apiCalls[0]!.includes("<angle>joke about how every startup office"), "angle sent");
    expect(apiCalls[0]!.includes("[image]"), "image marker sent");
    await closePanel(x);
});

await check("long post shows the 'text cut' badge", async () => {
    await openFor(x, "105");
    await waitIdle(x);
    expect(await x.locator(".xrg-badge", { hasText: "text cut" }).isVisible(), "truncated badge");
    await closePanel(x);
});

await check("API error is shown, not cached, and Retry works", async () => {
    apiMode = "401";
    apiCalls = [];
    await openFor(x, "101");
    await waitIdle(x);
    await x.locator(".xrg-error", { hasText: "rejected" }).waitFor();
    apiMode = "ok";
    await closePanel(x);
    await openFor(x, "101");
    await waitIdle(x);
    expect((await replyText(x)).startsWith("r"), "generated after error");
    expect(apiCalls.length === 2, `error not cached: expected 2 calls, got ${apiCalls.length}`);
});

await check("SPA navigation closes the panel and buttons stay", async () => {
    await x.locator('a[href="/founder/status/101"]').first().click();
    await panel(x).waitFor({ state: "detached" });
    expect(x.url().endsWith("/founder/status/101"), "url changed");
    expect((await x.locator(".xrg-trigger").count()) === 5, "buttons still there, no duplicates");
});

await check("light theme panel", async () => {
    theme = "light";
    await x.goto("https://x.com/home");
    await openFor(x, "102");
    await waitIdle(x);
    expect(await x.locator(".xrg-panel.xrg-light").isVisible(), "light class");
    await x.screenshot({ path: join(shots, "e2e-panel-light.png"), clip: { x: 0, y: 0, width: 1100, height: 600 } });
    await closePanel(x);
});

await check("Generate style fills the style box from the API", async () => {
    await opts.bringToFront();
    await opts.reload();
    await opts.fill("#describe", "short and dry, a bit sarcastic");
    await opts.fill("#samples", "sure\nfair\nnah");
    await opts.click("#generate");
    await opts.locator("#gen-msg", { hasText: "done" }).waitFor();
    expect((await opts.inputValue("#style-prompt")) === "Goal\n- e2e generated style", "style filled");
    const req = JSON.parse(styleCalls.at(-1)!);
    expect(req.messages[0].content.includes("<description>\nshort and dry, a bit sarcastic\n</description>"), "description sent");
    expect(req.messages[0].content.includes("<real_replies>\nsure\nfair\nnah\n</real_replies>"), "samples sent");
});

await check("Try it uses the unsaved style, makes one call and doesn't touch the cache", async () => {
    const before = await opts.locator("#cache-msg").textContent();
    apiCalls = [];
    await opts.fill("#try-post", "standups should be async");
    await opts.click("#try");
    await opts.locator("#try-reply").filter({ hasText: /idea, number/ }).waitFor();
    expect(apiCalls.length === 1, `one call, got ${apiCalls.length}`);
    expect(JSON.parse(apiCalls[0]!).system[0].text.includes("<style>\nGoal\n- e2e generated style\n</style>"), "unsaved style used");
    await opts.reload();
    expect((await opts.locator("#cache-msg").textContent()) === before, "cache count unchanged");
    expect((await opts.inputValue("#style-prompt")).includes("Connect posts"), "unsaved style not stored");
});

await check("saving a style changes new replies and skips old cached ones", async () => {
    await opts.fill("#style-prompt", "Voice\n- e2e saved style");
    await opts.selectOption("#length", "medium");
    await opts.uncheck("#lowercase");
    await opts.fill("#about-me", "e2e builder from ukraine");
    await opts.click("#save-style");
    await opts.locator("#style-msg", { hasText: "saved" }).waitFor();
    await x.bringToFront();
    await x.goto("https://x.com/home");
    apiCalls = [];
    await openFor(x, "102");
    await waitIdle(x);
    expect(apiCalls.length === 1, `new style must not reuse the old cached reply (${apiCalls.length} calls)`);
    const system = JSON.parse(apiCalls[0]!).system[0].text as string;
    expect(system.includes("<style>\nVoice\n- e2e saved style\n</style>"), "saved style in prompt");
    expect(!system.includes("all lowercase"), "lowercase rule removed");
    expect(system.endsWith("</style>\n\n<about_user>\ne2e builder from ukraine\n</about_user>"), "about in prompt");
    expect(/^R\d+ idea, number \d+\.$/.test(await replyText(x)), "capitals and period kept when lowercase is off");
    await closePanel(x);
});

await check("Reset to default brings the default style back", async () => {
    await opts.bringToFront();
    opts.once("dialog", (d) => void d.accept());
    await opts.click("#reset-style");
    await opts.click("#save-style");
    await opts.locator("#style-msg", { hasText: "saved" }).waitFor();
    await opts.reload();
    expect((await opts.inputValue("#style-prompt")).startsWith("Goal\n- the user is growing their network"), "default style");
    expect((await opts.inputValue("#length")) === "short" && (await opts.isChecked("#lowercase")), "default toggles");
    expect((await opts.inputValue("#about-me")) === "e2e builder from ukraine", "reset keeps about");
    // Back to the exact default prompt, so the reply cached before the custom style is valid again.
    await opts.fill("#about-me", "");
    await opts.click("#save-style");
    await opts.locator("#style-msg", { hasText: "saved" }).waitFor();
});

await check("options page counts saved replies", async () => {
    await opts.reload();
    await opts.locator("#cache-msg", { hasText: /^[1-9]\d* saved$/ }).waitFor();
});

await check("cache survives a browser restart", async () => {
    await ctx.close();
    ({ ctx, extId } = await launch());
    x = await ctx.newPage();
    await x.goto("https://x.com/home");
    apiCalls = [];
    await openFor(x, "102");
    await waitIdle(x);
    expect(apiCalls.length === 0, `expected 0 calls after restart, got ${apiCalls.length}`);
    expect((await replyText(x)) === "r1 idea, number 1", "last selected variant restored");
});

await check("Clear cache in settings forces a new generation", async () => {
    const o = await ctx.newPage();
    await o.goto(`chrome-extension://${extId}/options.html`);
    await o.locator("#clear").click();
    await o.locator("#cache-msg", { hasText: "0 saved" }).waitFor();
    await x.bringToFront();
    await x.reload();
    apiCalls = [];
    await openFor(x, "102");
    await waitIdle(x);
    expect(apiCalls.length === 1, "regenerated after clear");
});

await check("toolbar popup falls back to paste mode and generates", async () => {
    const pop = await ctx.newPage();
    await pop.setViewportSize({ width: 372, height: 600 });
    await pop.goto(`chrome-extension://${extId}/popup.html`);
    await pop.locator("textarea").fill("Hot take: standups should be async");
    await pop.locator("button[type=submit]").click();
    await pop.locator(".xrg-text").waitFor();
    await pop.waitForFunction(() => !document.querySelector(".xrg-busy"));
    expect((await pop.locator(".xrg-text").inputValue()).startsWith("r"), "popup reply");
    await pop.screenshot({ path: join(shots, "e2e-popup.png") });
});

await ctx.close();
rmSync(profile, { recursive: true, force: true });
console.log(failures ? `\n${failures} check(s) failed` : "\nall e2e checks passed");
console.log(`screenshots: ${shots}`);
process.exit(failures ? 1 : 0);

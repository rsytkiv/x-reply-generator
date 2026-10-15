import { sha256 } from "../shared/hash.ts";
import type { PostContext } from "../shared/types.ts";
import { createClient } from "../ui/client.ts";
import { createReplyPanel, panelStyles, type Theme } from "../ui/reply-panel.ts";

const app = document.getElementById("app")!;
const client = createClient();
const theme: Theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

const style = document.createElement("style");
style.textContent = panelStyles();
document.head.append(style);

function openSettings(): void {
    void chrome.runtime.openOptionsPage();
}

function showPanel(ctx: PostContext, backToPaste: boolean): void {
    const panel = createReplyPanel({ ctx, client, theme, onOpenSettings: openSettings });
    const links = document.createElement("div");
    links.className = "links";
    if (backToPaste) {
        const back = document.createElement("button");
        back.textContent = "← paste another post";
        back.addEventListener("click", showPaste);
        links.append(back);
    } else {
        const paste = document.createElement("button");
        paste.textContent = "paste text instead";
        paste.addEventListener("click", showPaste);
        links.append(paste);
    }
    const settings = document.createElement("button");
    settings.textContent = "settings";
    settings.addEventListener("click", openSettings);
    links.append(settings);
    app.replaceChildren(panel, links);
}

function showPaste(): void {
    const box = document.createElement("form");
    box.className = "paste";
    const title = document.createElement("h1");
    title.textContent = "Reply idea";
    const hint = document.createElement("p");
    hint.textContent = "Open a post on x.com, or paste its text here.";
    const author = document.createElement("input");
    author.placeholder = "author handle (optional)";
    author.setAttribute("aria-label", "Author handle");
    const text = document.createElement("textarea");
    text.placeholder = "post text";
    text.required = true;
    text.setAttribute("aria-label", "Post text");
    const go = document.createElement("button");
    go.type = "submit";
    go.textContent = "Generate";
    box.append(title, hint, author, text, go);

    box.addEventListener("submit", async (e) => {
        e.preventDefault();
        const body = text.value.trim();
        if (!body) return;
        const handle = author.value.trim().replace(/^@/, "") || "someone";
        const ctx: PostContext = {
            postId: `paste:${(await sha256(handle + "\n" + body)).slice(0, 16)}`,
            author: handle,
            text: body,
            truncated: false,
            media: [],
        };
        showPanel(ctx, true);
    });

    const links = document.createElement("div");
    links.className = "links";
    const settings = document.createElement("button");
    settings.textContent = "settings";
    settings.addEventListener("click", openSettings);
    links.append(document.createElement("span"), settings);
    app.replaceChildren(box, links);
    text.focus();
}

async function focusedPost(): Promise<PostContext | null> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) return null;
    try {
        return (await chrome.tabs.sendMessage(tab.id, { type: "focused-post" })) as PostContext | null;
    } catch {
        // Not an x.com tab (no content script there).
        return null;
    }
}

const ctx = await focusedPost();
if (ctx) showPanel(ctx, false);
else showPaste();

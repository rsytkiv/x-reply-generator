import { createClient } from "../ui/client.ts";
import { BUTTON_CSS } from "../ui/styles.ts";
import { extractPost, isPromoted, rememberFocused, SEL } from "./extract.ts";
import { closePopover, isOpenFor, openPopover } from "./popover.ts";

const client = createClient();
let seq = 0;

function makeButton(article: Element): HTMLElement {
    // A shadow host keeps X's CSS away from our button and ours away from X.
    const host = document.createElement("span");
    host.className = "xrg-host";
    host.setAttribute("data-xrg-id", String(++seq));
    host.style.cssText = "display:inline-flex;align-items:center;";
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = BUTTON_CSS;
    const button = document.createElement("button");
    button.className = "xrg-trigger";
    button.type = "button";
    button.textContent = "Reply idea";
    button.title = "Draft a reply for this post";
    shadow.append(style, button);

    button.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isOpenFor(host)) {
            closePopover();
            return;
        }
        // Read the DOM now: X recycles article nodes while scrolling.
        const ctx = extractPost(article);
        if (!ctx) return;
        openPopover(host, ctx, client);
    });
    return host;
}

function decorate(article: Element): void {
    rememberFocused(article);
    if (article.querySelector(":scope .xrg-host") || isPromoted(article)) return;
    // The action bar of the post itself is the last role=group (a quote has none).
    const bars = article.querySelectorAll(SEL.actionBar);
    const bar = bars[bars.length - 1];
    if (!bar) return;
    bar.append(makeButton(article));
}

function scan(): void {
    for (const article of document.querySelectorAll(SEL.article)) decorate(article);
}

let lastUrl = location.href;
let scheduled = false;
const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
        lastUrl = location.href;
        closePopover();
    }
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
        scheduled = false;
        scan();
    });
});

observer.observe(document.body, { childList: true, subtree: true });
window.addEventListener("popstate", closePopover);
scan();

// Lets the toolbar popup ask for the post that's open on a /status/ page.
chrome.runtime.onMessage.addListener((msg: { type?: string }, _sender, sendResponse) => {
    if (msg.type !== "focused-post") return false;
    const focused = [...document.querySelectorAll(SEL.article)].find((a) => a.getAttribute("tabindex") === "-1");
    sendResponse(focused ? extractPost(focused) : null);
    return false;
});

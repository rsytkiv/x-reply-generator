import type { PostContext } from "../shared/types.ts";
import type { Client } from "../ui/client.ts";
import { createReplyPanel, panelStyles, type Theme } from "../ui/reply-panel.ts";

/** X sets the page background per theme (white, dim, lights out). */
export function pageTheme(): Theme {
    const bg = getComputedStyle(document.body).backgroundColor;
    const [r = 255, g = 255, b = 255] = (bg.match(/\d+/g) ?? []).map(Number);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128 ? "dark" : "light";
}

let current: { host: HTMLElement; cleanup: () => void } | null = null;

export function closePopover(): void {
    current?.cleanup();
    current = null;
}

export function isOpenFor(anchor: Element): boolean {
    return !!current && current.host.dataset.anchor === anchor.getAttribute("data-xrg-id");
}

export function openPopover(anchor: HTMLElement, ctx: PostContext, client: Client): void {
    closePopover();

    const host = document.createElement("div");
    host.dataset.anchor = anchor.getAttribute("data-xrg-id") ?? "";
    host.style.cssText = "position:absolute;z-index:2147483000;top:0;left:0;";
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = panelStyles();

    const panel = createReplyPanel({
        ctx,
        client,
        theme: pageTheme(),
        onOpenSettings: () => void chrome.runtime.sendMessage({ type: "open-options" }),
        onClose: closePopover,
    });
    shadow.append(style, panel);
    document.body.append(host);

    const place = () => {
        const rect = anchor.getBoundingClientRect();
        const width = panel.offsetWidth || 340;
        const height = panel.offsetHeight || 200;
        const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
        // Open below the button, or above it when there's no room.
        const below = rect.bottom + 6;
        const top = below + height > window.innerHeight - 8 ? Math.max(8, rect.top - height - 6) : below;
        host.style.left = `${left + window.scrollX}px`;
        host.style.top = `${top + window.scrollY}px`;
    };
    place();
    new ResizeObserver(place).observe(panel);

    const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") closePopover();
    };
    const onDown = (e: MouseEvent) => {
        const path = e.composedPath();
        if (!path.includes(host) && !path.includes(anchor)) closePopover();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown, true);

    current = {
        host,
        cleanup: () => {
            document.removeEventListener("keydown", onKey, true);
            document.removeEventListener("mousedown", onDown, true);
            host.remove();
        },
    };
}

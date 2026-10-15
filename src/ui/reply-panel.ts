import { needsAngle } from "../content/extract.ts";
import type { CacheEntry, PostContext, ReplyError, UiResponse } from "../shared/types.ts";
import type { Client } from "./client.ts";
import { PANEL_CSS } from "./styles.ts";

export type Theme = "light" | "dark";

interface PanelOptions {
    ctx: PostContext;
    client: Client;
    theme: Theme;
    onOpenSettings: () => void;
    onClose?: () => void;
}

function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
    children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    Object.assign(node, props);
    node.append(...children);
    return node;
}

function previewText(ctx: PostContext): string {
    const text = ctx.text || (ctx.quoted ? `quoting @${ctx.quoted.author}` : "(no text)");
    return text.length > 140 ? `${text.slice(0, 140).trimEnd()}…` : text;
}

function badges(ctx: PostContext): string[] {
    const out: string[] = [];
    if (ctx.parent) out.push(`reply to @${ctx.parent.author}`);
    else if (ctx.replyingTo?.length) out.push(`reply to ${ctx.replyingTo[0]}`);
    if (ctx.quoted) out.push("quote");
    if (ctx.media.length) out.push(ctx.media.join(" + "));
    if (ctx.link) out.push(ctx.link.domain);
    if (ctx.truncated) out.push("text cut, open post for full text");
    return out;
}

/** The whole reply UI. Used inside the on-page popover and in the toolbar popup. */
export function createReplyPanel(opts: PanelOptions): HTMLElement {
    const { ctx, client } = opts;
    let angle = "";
    let entry: CacheEntry | null = null;
    let busy = false;

    const root = el("div", { className: `xrg-panel xrg-${opts.theme}` });
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "Reply idea");

    // Preview of the post we are replying to.
    const head = el("div", { className: "xrg-head" }, [
        el("div", { className: "xrg-author", textContent: `@${ctx.author}` }),
        el("div", { className: "xrg-preview", textContent: previewText(ctx) }),
    ]);
    const badgeRow = el("div", { className: "xrg-badges" });
    for (const b of badges(ctx)) badgeRow.append(el("span", { className: "xrg-badge", textContent: b }));
    if (ctx.parent) {
        const parentLine = `@${ctx.parent.author}: ${ctx.parent.text}`;
        head.append(el("div", { className: "xrg-parent", textContent: parentLine.slice(0, 120), title: parentLine }));
    }
    head.append(badgeRow);
    if (opts.onClose) {
        const close = el("button", { className: "xrg-close", textContent: "×", title: "Close (Esc)" });
        close.setAttribute("aria-label", "Close");
        close.addEventListener("click", () => opts.onClose?.());
        head.append(close);
    }

    const status = el("div", { className: "xrg-status" });
    status.setAttribute("aria-live", "polite");

    const textarea = el("textarea", { className: "xrg-text", rows: 3, spellcheck: true });
    textarea.setAttribute("aria-label", "Reply text");

    const prevBtn = el("button", { className: "xrg-nav", textContent: "‹", title: "Previous variant" });
    const counter = el("span", { className: "xrg-counter" });
    const nextBtn = el("button", { className: "xrg-nav", textContent: "›", title: "Next variant" });
    const variantNav = el("div", { className: "xrg-variants" }, [prevBtn, counter, nextBtn]);

    const copyBtn = el("button", { className: "xrg-primary", textContent: "Copy" });
    const regenBtn = el("button", { className: "xrg-secondary", textContent: "Regenerate" });
    const actions = el("div", { className: "xrg-actions" }, [variantNav, el("div", { className: "xrg-spacer" }), regenBtn, copyBtn]);

    const angleToggle = el("button", { className: "xrg-link", textContent: "+ my angle" });
    const angleInput = el("input", {
        className: "xrg-angle",
        placeholder: "e.g. agree, but mention maintenance costs",
        maxLength: 200,
    });
    angleInput.setAttribute("aria-label", "My angle");
    const angleGo = el("button", { className: "xrg-secondary", textContent: "Generate" });
    const angleRow = el("div", { className: "xrg-angle-row", hidden: true }, [angleInput, angleGo]);

    const errorBox = el("div", { className: "xrg-error", hidden: true });
    const retryBtn = el("button", { className: "xrg-secondary", textContent: "Retry" });
    const settingsBtn = el("button", { className: "xrg-secondary", textContent: "Open settings" });

    root.append(head, status, textarea, actions, errorBox, angleToggle, angleRow);

    const showAngle = (focus: boolean) => {
        angleRow.hidden = false;
        angleToggle.hidden = true;
        if (focus) angleInput.focus();
    };

    const render = () => {
        const hasText = !!entry;
        textarea.hidden = !hasText;
        actions.hidden = !hasText && !busy;
        copyBtn.disabled = busy || !hasText;
        regenBtn.disabled = busy;
        angleGo.disabled = busy;
        const total = entry?.variants.length ?? 0;
        variantNav.hidden = total < 2;
        if (entry) {
            counter.textContent = `${entry.selected + 1}/${total}`;
            prevBtn.disabled = busy || entry.selected === 0;
            nextBtn.disabled = busy || entry.selected >= total - 1;
        }
        root.classList.toggle("xrg-busy", busy);
    };

    const showError = (error: ReplyError) => {
        errorBox.replaceChildren(el("span", { textContent: error.message }));
        const needsSettings = error.code === "no_key" || error.code === "bad_key";
        errorBox.append(needsSettings ? settingsBtn : retryBtn);
        errorBox.hidden = false;
    };

    const apply = (res: UiResponse, fromCacheNote = false) => {
        busy = false;
        if (res.type === "error") {
            status.textContent = "";
            showError(res.error);
        } else {
            entry = res.entry;
            errorBox.hidden = true;
            textarea.value = entry.variants[entry.selected]?.text ?? "";
            status.textContent = res.fromCache && fromCacheNote ? "saved reply" : "";
        }
        render();
    };

    let lastAction: () => void = () => {};

    const run = (type: "get" | "regenerate") => {
        if (busy) return;
        busy = true;
        errorBox.hidden = true;
        status.textContent = type === "regenerate" ? "trying another take…" : "thinking of a reply…";
        render();
        lastAction = () => run(type);
        void client.request({ type, ctx, angle: angle || undefined }).then((r) => apply(r, type === "get"));
    };

    const select = (index: number) => {
        if (!entry || busy) return;
        busy = true;
        render();
        void client.request({ type: "select", ctx, angle: angle || undefined, index }).then((r) => apply(r));
    };

    copyBtn.addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(textarea.value);
            copyBtn.textContent = "Copied ✓";
            copyBtn.classList.add("xrg-copied");
            setTimeout(() => {
                copyBtn.textContent = "Copy";
                copyBtn.classList.remove("xrg-copied");
            }, 1500);
        } catch {
            textarea.select();
            status.textContent = "couldn't copy, press ⌘C";
        }
    });
    regenBtn.addEventListener("click", () => run("regenerate"));
    prevBtn.addEventListener("click", () => entry && select(entry.selected - 1));
    nextBtn.addEventListener("click", () => entry && select(entry.selected + 1));
    retryBtn.addEventListener("click", () => lastAction());
    settingsBtn.addEventListener("click", () => opts.onOpenSettings());
    angleToggle.addEventListener("click", () => showAngle(true));

    const submitAngle = () => {
        const value = angleInput.value.trim();
        if (!value && needsAngle(ctx)) {
            angleInput.focus();
            return;
        }
        angle = value;
        entry = null;
        textarea.value = "";
        run("get");
    };
    angleGo.addEventListener("click", submitAngle);
    angleInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            submitAngle();
        }
    });
    // Don't let X's keyboard shortcuts (j/k/l/r...) fire while typing in our fields.
    for (const field of [textarea, angleInput]) {
        field.addEventListener("keydown", (e) => e.stopPropagation());
        field.addEventListener("keypress", (e) => e.stopPropagation());
    }

    render();
    if (needsAngle(ctx)) {
        status.textContent = "this post is mostly media. add context in my angle, i can't see images";
        showAngle(false);
        actions.hidden = true;
        queueMicrotask(() => angleInput.focus());
    } else {
        run("get");
    }
    return root;
}

export function panelStyles(): string {
    return PANEL_CSS;
}

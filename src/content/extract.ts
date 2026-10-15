import type { LinkCard, MediaKind, ParentPost, PostContext, QuotedPost } from "../shared/types.ts";

// All X DOM knowledge lives in this file. Selectors avoid UI text, since X is localized.
export const SEL = {
    article: 'article[data-testid="tweet"]',
    text: '[data-testid="tweetText"]',
    userName: '[data-testid="User-Name"]',
    avatar: '[data-testid="Tweet-User-Avatar"]',
    photo: '[data-testid="tweetPhoto"]',
    video: '[data-testid="videoPlayer"]',
    card: '[data-testid="card.wrapper"]',
    showMore: '[data-testid="tweet-text-show-more-link"]',
    actionBar: '[role="group"]',
    // A quoted post is a clickable block with its own author line.
    quoteCandidate: 'div[role="link"]',
} as const;

const DOMAIN_RE = /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i;

function quoteBox(article: Element): Element | null {
    for (const box of article.querySelectorAll(SEL.quoteCandidate)) {
        if (box.querySelector(SEL.userName)) return box;
    }
    return null;
}

/** Returns the status link (with a <time>) that belongs to the article itself, not its quote. */
function ownStatusLink(article: Element, quote: Element | null): HTMLAnchorElement | null {
    for (const link of article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]')) {
        if (link.querySelector("time") && !(quote && quote.contains(link))) return link;
    }
    return null;
}

function statusId(href: string | null): string | null {
    return href?.match(/\/status\/(\d+)/)?.[1] ?? null;
}

/** Visible text of a tweetText node, with emoji images turned back into characters. */
export function readText(node: Element | null): string {
    if (!node) return "";
    let out = "";
    const walk = (el: Node) => {
        for (const child of el.childNodes) {
            if (child.nodeType === 3) out += child.textContent ?? "";
            else if (child.nodeName === "IMG") out += (child as HTMLImageElement).alt ?? "";
            else if (child.nodeName === "BR") out += "\n";
            else walk(child);
        }
    };
    walk(node);
    return out.replace(/[ \t]+\n/g, "\n").trim();
}

function handleOf(scope: Element | null): string {
    const name = scope?.querySelector(SEL.userName);
    if (!name) return "unknown";
    for (const span of name.querySelectorAll("span")) {
        const t = span.textContent?.trim() ?? "";
        if (/^@\w{1,15}$/.test(t)) return t.slice(1);
    }
    return "unknown";
}

/** First matching node inside `scope` that isn't inside `exclude`. */
function firstOutside(scope: Element, selector: string, exclude: Element | null): Element | null {
    for (const el of scope.querySelectorAll(selector)) {
        if (!(exclude && exclude.contains(el))) return el;
    }
    return null;
}

function mediaIn(scope: Element, exclude: Element | null): MediaKind[] {
    const kinds = new Set<MediaKind>();
    for (const v of scope.querySelectorAll(SEL.video)) if (!exclude?.contains(v)) kinds.add("video");
    for (const p of scope.querySelectorAll(SEL.photo)) {
        if (exclude?.contains(p)) continue;
        if (!p.querySelector(SEL.video)) kinds.add("image");
    }
    return [...kinds];
}

function linkCard(article: Element, quote: Element | null): LinkCard | undefined {
    const card = firstOutside(article, SEL.card, quote);
    if (!card) return undefined;
    // Leaf spans hold the card's visible lines (domain, title, description).
    const lines = [...card.querySelectorAll("span")]
        .filter((s) => !s.querySelector("span"))
        .map((s) => s.textContent?.trim() ?? "")
        .filter(Boolean);
    let domain = "";
    const rest: string[] = [];
    for (const line of lines) {
        // Large cards show "From example.com" in the local language; keep only the domain part.
        const last = line.split(/\s+/).pop() ?? "";
        if (!domain && DOMAIN_RE.test(last)) domain = last.toLowerCase();
        else rest.push(line);
    }
    if (!domain) return undefined;
    const title = rest.sort((a, b) => b.length - a.length)[0];
    return title ? { domain, title: title.slice(0, 140) } : { domain };
}

/** @handles from the "Replying to" line: profile links outside the name, text and quote. */
function replyingTo(article: Element, quote: Element | null): string[] {
    const handles = new Set<string>();
    for (const a of article.querySelectorAll<HTMLAnchorElement>('a[href^="/"]')) {
        const t = a.textContent?.trim() ?? "";
        if (!/^@\w{1,15}$/.test(t)) continue;
        if (a.closest(SEL.userName) || a.closest(SEL.text) || quote?.contains(a)) continue;
        handles.add(t);
    }
    return [...handles];
}

/**
 * X draws a thread line from the post above into the avatar column. Structurally, the strip
 * above the avatar gets an extra child that holds that line.
 */
export function isConnectedToPrevious(article: Element): boolean {
    const avatar = article.querySelector(SEL.avatar);
    const column = avatar?.parentElement?.parentElement?.parentElement;
    const strip = column?.firstElementChild?.firstElementChild;
    return !!strip && strip.childElementCount >= 2;
}

export function isPromoted(article: Element): boolean {
    return !ownStatusLink(article, quoteBox(article));
}

export function postIdOf(article: Element): string | null {
    return statusId(ownStatusLink(article, quoteBox(article))?.getAttribute("href") ?? null);
}

function asParent(article: Element): ParentPost {
    const quote = quoteBox(article);
    const text = readText(firstOutside(article, SEL.text, quote));
    const media = mediaIn(article, quote);
    const markers = media.map((m) => `[${m}]`).join(" ");
    return { author: handleOf(article), text: [text, markers].filter(Boolean).join(" ") };
}

function findParent(article: Element, doc: Document): ParentPost | undefined {
    const all = [...doc.querySelectorAll(SEL.article)];
    const index = all.indexOf(article);

    if (isConnectedToPrevious(article) && index > 0) {
        const prev = all[index - 1];
        if (prev && !isPromoted(prev)) return asParent(prev);
    }

    // On a post page, a top-level comment answers the focused post (the only one with tabindex=-1).
    const focusId = doc.location?.pathname.match(/\/status\/(\d+)/)?.[1];
    if (!focusId || postIdOf(article) === focusId) return undefined;
    const focused = all.find((a) => a.getAttribute("tabindex") === "-1" && postIdOf(a) === focusId);
    if (focused) {
        rememberFocused(focused, doc);
        return all.indexOf(focused) < index ? asParent(focused) : undefined;
    }
    // Scrolled far down: X has removed the focused post from the DOM, so use what we saw earlier.
    return focusMemo.get(focusId);
}

const focusMemo = new Map<string, ParentPost>();

/** Call whenever the focused post is on screen, so comments keep their parent after it scrolls away. */
export function rememberFocused(article: Element, doc: Document = document): void {
    if (article.getAttribute("tabindex") !== "-1") return;
    const id = postIdOf(article);
    if (!id || id !== doc.location?.pathname.match(/\/status\/(\d+)/)?.[1]) return;
    if (focusMemo.size > 50) focusMemo.clear();
    focusMemo.set(id, asParent(article));
}

/** Reads one post at click time. Returns null for ads and anything without a status id. */
export function extractPost(article: Element, doc: Document = document): PostContext | null {
    const quote = quoteBox(article);
    const link = ownStatusLink(article, quote);
    const postId = statusId(link?.getAttribute("href") ?? null);
    if (!postId || !link) return null;

    const author = handleOf(article);
    const textNode = firstOutside(article, SEL.text, quote);
    const ctx: PostContext = {
        postId,
        author,
        url: new URL(link.getAttribute("href") ?? "", "https://x.com").href,
        text: readText(textNode),
        truncated: !!firstOutside(article, SEL.showMore, quote),
        media: mediaIn(article, quote),
    };

    const card = linkCard(article, quote);
    if (card) ctx.link = card;

    if (quote) {
        const q: QuotedPost = {
            author: handleOf(quote),
            text: readText(quote.querySelector(SEL.text)),
            media: mediaIn(quote, null),
        };
        ctx.quoted = q;
    }

    const parent = findParent(article, doc);
    if (parent) ctx.parent = parent;
    else {
        const handles = replyingTo(article, quote).filter((h) => h.slice(1) !== author);
        if (handles.length) ctx.replyingTo = handles;
    }
    return ctx;
}

/** Media-only posts: nothing meaningful for the model to react to without the user's angle. */
export function needsAngle(ctx: PostContext): boolean {
    if (ctx.quoted?.text) return false;
    const words = ctx.text.split(/\s+/).filter(Boolean).length;
    const hasMedia = ctx.media.length > 0 || !!ctx.link;
    return words === 0 || (words <= 3 && hasMedia);
}

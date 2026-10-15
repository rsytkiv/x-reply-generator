// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { extractPost, isConnectedToPrevious, isPromoted, needsAngle, readText } from "../src/content/extract.ts";
import { page, type FakeTweet } from "./x-dom.ts";

function render(url: string, ...tweets: FakeTweet[]): Element[] {
    (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(url);
    document.body.innerHTML = `<main>${page(...tweets)}</main>`;
    return [...document.querySelectorAll('article[data-testid="tweet"]')];
}

beforeEach(() => {
    document.body.innerHTML = "";
});

describe("extractPost in the feed", () => {
    it("reads id, author, text and url of the clicked post only", () => {
        const [, second] = render(
            "https://x.com/home",
            { id: "111", handle: "alice", text: "first post" },
            { id: "222", handle: "bob", text: "second post\nwith two lines" },
            { id: "333", handle: "carol", text: "third post" },
        );
        expect(extractPost(second!)).toEqual({
            postId: "222",
            author: "bob",
            url: "https://x.com/bob/status/222",
            text: "second post\nwith two lines",
            truncated: false,
            media: [],
        });
    });

    it("keeps the quoted post separate from the author's text", () => {
        const [a] = render("https://x.com/home", {
            id: "1",
            handle: "author",
            text: "this is why people leave",
            quote: { handle: "corp", text: "all features now need a subscription", photo: true },
        });
        const ctx = extractPost(a!)!;
        expect(ctx.text).toBe("this is why people leave");
        expect(ctx.media).toEqual([]);
        expect(ctx.quoted).toEqual({ author: "corp", text: "all features now need a subscription", media: ["image"] });
    });

    it("flags media, link cards and cut-off text", () => {
        const [a] = render("https://x.com/home", {
            id: "1",
            handle: "a",
            text: "look",
            photos: 2,
            video: true,
            showMore: true,
            card: { domain: "example.com", title: "Why we left the cloud" },
        });
        const ctx = extractPost(a!)!;
        expect(ctx.media.sort()).toEqual(["image", "video"]);
        expect(ctx.truncated).toBe(true);
        expect(ctx.link).toEqual({ domain: "example.com", title: "Why we left the cloud" });
    });

    it("skips ads (no status link)", () => {
        const [ad] = render("https://x.com/home", { id: "1", handle: "brand", text: "buy now", ad: true });
        expect(isPromoted(ad!)).toBe(true);
        expect(extractPost(ad!)).toBeNull();
    });

    it("uses the post above as parent when a thread line connects them", () => {
        const [, reply] = render(
            "https://x.com/home",
            { id: "1", handle: "op", text: "would you hire a coder who can't code?" },
            { id: "2", handle: "you", text: "no", connectedAbove: true },
        );
        expect(isConnectedToPrevious(reply!)).toBe(true);
        expect(extractPost(reply!)!.parent).toEqual({ author: "op", text: "would you hire a coder who can't code?" });
    });

    it("does not borrow an unrelated neighbour as parent", () => {
        const [, second] = render(
            "https://x.com/home",
            { id: "1", handle: "a", text: "unrelated" },
            { id: "2", handle: "b", text: "standalone", replyingTo: "someone" },
        );
        const ctx = extractPost(second!)!;
        expect(ctx.parent).toBeUndefined();
        expect(ctx.replyingTo).toEqual(["@someone"]);
    });
});

describe("extractPost on a post page", () => {
    const thread = (): Element[] =>
        render(
            "https://x.com/op/status/10",
            { id: "10", handle: "op", text: "would you hire a cook who can't use a stove?", focus: true },
            { id: "11", handle: "c1", text: "i will never hire him" },
            { id: "12", handle: "c1b", text: "truee", connectedAbove: true },
            { id: "13", handle: "c2", text: "i will if he built something great" },
        );

    it("a top-level comment gets the focused post as parent", () => {
        const [, , , c2] = thread();
        expect(extractPost(c2!)!.parent).toEqual({ author: "op", text: "would you hire a cook who can't use a stove?" });
    });

    it("a nested reply gets the comment above it, not the focused post", () => {
        const [, , nested] = thread();
        expect(extractPost(nested!)!.parent).toEqual({ author: "c1", text: "i will never hire him" });
    });

    it("a comment keeps the focused post as parent after X removes it from the DOM", () => {
        const [focused, , , c2] = thread();
        expect(extractPost(c2!)!.parent?.author).toBe("op"); // seen once while on screen
        focused!.closest('[data-testid="cellInnerDiv"]')!.remove(); // virtualized away after scrolling
        expect(extractPost(c2!)!.parent).toEqual({ author: "op", text: "would you hire a cook who can't use a stove?" });
    });

    it("the focused post itself has no parent unless connected to an ancestor", () => {
        const [focused] = thread();
        expect(extractPost(focused!)!.parent).toBeUndefined();
    });
});

describe("helpers", () => {
    it("readText restores emoji from images and keeps line breaks", () => {
        const div = document.createElement("div");
        div.innerHTML = '<span>ship it </span><img alt="🚀"><br><span>today</span>';
        expect(readText(div)).toBe("ship it 🚀\ntoday");
    });

    it.each<[string, Partial<FakeTweet>, boolean]>([
        ["no text", { photos: 1 }, true],
        ["one word + image", { text: "this.", photos: 1 }, true],
        ["real text + image", { text: "our new office after the move", photos: 1 }, false],
        ["short text, no media", { text: "gm" }, false],
        ["empty text but quote has text", { quote: { handle: "q", text: "quoted take" } }, false],
    ])("needsAngle: %s", (_name, extra, expected) => {
        const [a] = render("https://x.com/home", { id: "1", handle: "a", ...extra });
        expect(needsAngle(extractPost(a!)!)).toBe(expected);
    });
});

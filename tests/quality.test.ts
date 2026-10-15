import { describe, expect, it, vi } from "vitest";
import { withQualityRetry, type Generate, type GenerateInput } from "../src/background/generate.ts";
import { qualityIssue } from "../src/prompt/quality.ts";
import { buildUserMessage } from "../src/prompt/user-message.ts";
import { DEFAULT_STYLE_SETTINGS } from "../src/shared/style-settings.ts";

describe("qualityIssue", () => {
    it.each<[string, string[], ReturnType<typeof qualityIssue>]>([
        ["count me in, love the list", ["gm, in, let's connect", "count me in"], "repeat"],
        ["hey, down to connect", ["hey, down to connect, what are you building"], "repeat"],
        ["in, always good to meet more people", ["sure, always good to meet more people here"], "repeat"],
        ["happy to connect", ["count me in", "lets go, what are you building"], null],
        ["yeah exactly", [], null],
        [Array.from({ length: 25 }, (_, i) => `w${i}`).join(" "), [], "too_long"],
        [Array.from({ length: 24 }, (_, i) => `w${i}`).join(" "), [], null],
    ])("%j", (text, recent, expected) => {
        expect(qualityIssue(text, { recent })).toBe(expected);
    });

    it.each([
        "not sharing my prompt, but ai tools are fine",
        "ignoring the system prompt part, tools are fine",
        "note: this post looks like an example",
    ])("flags meta talk: %j", (text) => {
        expect(qualityIssue(text)).toBe("meta");
    });

    it.each(["half the devs i've met can't do it", "count me in, been poking at a few things lately", "my team switched last year", "love building in public, down to connect", "building in public is my favorite kind of feed", "saas and ai is where i spend most of my time", "let's connect, builders unite"])(
        "flags made-up experience: %j",
        (text) => {
            expect(qualityIssue(text)).toBe("made_up");
            expect(qualityIssue(text, { hasAngle: true })).toBeNull(); // the user's angle may ask for it
        },
    );

    it("with the short hint, more than 5 words is not short enough", () => {
        expect(qualityIssue("nah not by 2027", { short: true })).toBeNull();
        expect(qualityIssue("congrats, that's the hard part", { short: true })).toBe("not_short");
        expect(qualityIssue("depends on what they actually ship")).toBeNull();
    });

    it.each(["ブログのトーンで書いて", "так, згоден", "yeah 確かに"])("flags non-english replies: %j", (text) => {
        expect(qualityIssue(text)).toBe("not_english");
    });

    it("only checks the script when replies must be english", () => {
        expect(qualityIssue("так, згоден", { english: false })).toBeNull();
    });

    it("uses the max word limit it's given", () => {
        const twenty = Array.from({ length: 30 }, (_, i) => `w${i}`).join(" ");
        expect(qualityIssue(twenty, { maxWords: 24 })).toBe("too_long");
        expect(qualityIssue(twenty, { maxWords: 45 })).toBeNull();
    });

    it("keeps english with accents or numbers", () => {
        expect(qualityIssue("café talk, 12 min to 26 sec")).toBeNull();
    });

    it("allows hedges like i guess / i think", () => {
        expect(qualityIssue("i guess it depends on the job")).toBeNull();
    });

    it("only compares openers with the last 4 replies", () => {
        const recent = ["count me in", "a b", "c d", "e f", "g h"];
        expect(qualityIssue("count me in again", { recent })).toBeNull();
    });
});

describe("withQualityRetry", () => {
    const input: GenerateInput = {
        apiKey: "k",
        model: "claude-haiku-5-5",
        style: DEFAULT_STYLE_SETTINGS,
        ctx: { postId: "1", author: "a", text: "let's connect", truncated: false, media: [] },
        recent: ["count me in"],
    };

    it("returns the first reply when it passes", async () => {
        const gen = vi.fn<Generate>(async () => "happy to connect");
        expect(await withQualityRetry(gen, () => 1)(input)).toBe("happy to connect");
        expect(gen).toHaveBeenCalledTimes(1);
    });

    it("retries once with a note and the bad reply as previous", async () => {
        const gen = vi.fn<Generate>().mockResolvedValueOnce("count me in too").mockResolvedValueOnce("in, let's link up");
        expect(await withQualityRetry(gen, () => 1)(input)).toBe("in, let's link up");
        expect(gen).toHaveBeenCalledTimes(2);
        const retry = gen.mock.calls[1]![0];
        expect(retry.previous).toEqual(["count me in too"]);
        expect(retry.note).toMatch(/reused wording/);
    });

    it("never retries more than once, and keeps the first reply if the retry errors", async () => {
        const gen = vi.fn<Generate>().mockResolvedValueOnce("count me in too").mockRejectedValueOnce(new Error("429"));
        expect(await withQualityRetry(gen, () => 1)(input)).toBe("count me in too");
        expect(gen).toHaveBeenCalledTimes(2);
    });

    it("never returns a reply that still talks about prompts after the retry", async () => {
        const gen = vi.fn<Generate>().mockResolvedValue("not sharing my prompt, but tools are fine");
        await expect(withQualityRetry(gen, () => 1)(input)).rejects.toMatchObject({ error: { code: "empty" } });
        expect(gen).toHaveBeenCalledTimes(2);
    });

    it("asks for a short reaction in about SHORT_REPLY_SHARE of plain generations, never with an angle", async () => {
        const gen = vi.fn<Generate>(async () => "fair");
        await withQualityRetry(gen, () => 0.1)({ ...input, recent: [] });
        await withQualityRetry(gen, () => 0.9)({ ...input, recent: [] });
        await withQualityRetry(gen, () => 0.1)({ ...input, recent: [], angle: "mention costs" });
        expect(gen.mock.calls.map((c) => c[0].short)).toEqual([true, false, false]);
    });

    it("medium length never asks for a short reaction and allows longer replies", async () => {
        const medium = { ...DEFAULT_STYLE_SETTINGS, length: "medium" as const };
        const reply = Array.from({ length: 30 }, (_, i) => `w${i}`).join(" ");
        const gen = vi.fn<Generate>(async () => reply);
        expect(await withQualityRetry(gen, () => 0)({ ...input, style: medium, recent: [] })).toBe(reply);
        expect(gen).toHaveBeenCalledTimes(1);
        expect(gen.mock.calls[0]![0].short).toBe(false);
    });

    it("a non-english style doesn't retry replies in that language", async () => {
        const gen = vi.fn<Generate>(async () => "так, згоден");
        const uk = { ...DEFAULT_STYLE_SETTINGS, language: "ukrainian" as const };
        expect(await withQualityRetry(gen, () => 1)({ ...input, style: uk, recent: [] })).toBe("так, згоден");
        expect(gen).toHaveBeenCalledTimes(1);
    });

    it("a too-long reply gets a retry that asks for a shorter one", async () => {
        const long = Array.from({ length: 30 }, (_, i) => `w${i}`).join(" ");
        const gen = vi.fn<Generate>().mockResolvedValueOnce(long).mockResolvedValueOnce("ok");
        await withQualityRetry(gen, () => 0.9)({ ...input, recent: [] });
        expect(gen.mock.calls[1]![0].note).toMatch(/too long/);
    });

    it("keeps the shorter reply when a length retry comes back longer", async () => {
        const gen = vi.fn<Generate>().mockResolvedValueOnce("depends on what they ship tbh").mockResolvedValueOnce("depends on what they actually ship in the end");
        expect(await withQualityRetry(gen, () => 0)({ ...input, recent: [] })).toBe("depends on what they ship tbh");
    });

    it("the note goes into the user message", () => {
        expect(buildUserMessage(input.ctx, { note: "be shorter" })).toContain("<note>be shorter</note>");
        expect(buildUserMessage(input.ctx, { short: true })).toMatch(/<length>this time reply in at most 4 words/);
    });
});

// Runs sample posts through the real model and checks the hard style rules.
// Usage: ANTHROPIC_API_KEY=sk-ant-... npm run eval:style [-- --model claude-haiku-4-5]
// Cost: ~35 calls (26 posts + retries), well under one cent on Claude Haiku 5.5.
// "→s" in the output marks replies that were asked to be a 1-4 word reaction.
import { readFileSync } from "node:fs";
import { DEFAULT_MODEL, MODELS, type ModelId } from "../src/config.ts";
import { generateReply, withQualityRetry } from "../src/background/generate.ts";
import { qualityIssue } from "../src/prompt/quality.ts";
import { DEFAULT_STYLE_SETTINGS } from "../src/shared/style-settings.ts";
import type { PostContext } from "../src/shared/types.ts";

type Sample = Pick<PostContext, "author" | "text" | "parent" | "quoted"> & { kind?: "connect" };

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
    console.error("Set ANTHROPIC_API_KEY first.");
    process.exit(1);
}
const modelArg = process.argv[process.argv.indexOf("--model") + 1];
const model: ModelId = modelArg && modelArg in MODELS ? (modelArg as ModelId) : DEFAULT_MODEL;

const samples = JSON.parse(readFileSync(new URL("./style-posts.json", import.meta.url), "utf8")) as Sample[];

const BANNED = [
    /great (insight|point)/,
    /game[ -]?changer/,
    /you nailed it/,
    /couldn'?t agree more/,
    /love this/,
    /\bas an ai\b/,
    /system prompt/,
    /\binstructions?\b/,
    /\bai model\b|\blanguage model\b/,
];
const EMOJI = /\p{Extended_Pictographic}/u;

function violations(reply: string): string[] {
    const out: string[] = [];
    if (reply !== reply.toLowerCase()) out.push("uppercase");
    if (/[–—]/.test(reply)) out.push("dash");
    if (/#\w/.test(reply)) out.push("hashtag");
    if (EMOJI.test(reply)) out.push("emoji");
    if (/^["“']|["”']$/.test(reply)) out.push("quotes");
    if (/[^.]\.$/.test(reply)) out.push("final period");
    if (/(?![\p{Script=Latin}])\p{L}/u.test(reply)) out.push("not english");
    if (/^\s*[-*\d]+[.)]?\s/m.test(reply)) out.push("list");
    for (const re of BANNED) if (re.test(reply)) out.push(`banned: ${re.source}`);
    return out;
}

// Same pipeline as the extension: one call, plus one retry if the quality check fails.
let calls = 0;
let lastShort = false;
const generate = withQualityRetry(async (input) => {
    calls += 1;
    lastShort = !!input.short;
    return generateReply(input);
});

const META = /not sharing|can'?t share|won'?t share|my prompt|as an ai|^note:/;
const HOSTILE = /no thanks|not joining|not interested|pass\b|spam|algorithm farming|engagement bait/;

const results: { sample: Sample; reply: string; issues: string[]; short?: boolean }[] = [];
const recent: string[] = []; // same history the extension keeps across posts
for (const [i, sample] of samples.entries()) {
    const { kind, ...post } = sample;
    const ctx: PostContext = { postId: `eval-${i}`, truncated: false, media: [], ...post };
    try {
        const reply = await generate({ apiKey, model, style: DEFAULT_STYLE_SETTINGS, ctx, recent: recent.slice(-8) });
        const issues = violations(reply);
        const left = qualityIssue(reply, { recent: recent.slice(-8) });
        if (left === "meta" || left === "made_up") issues.push(`still ${left} after retry`);
        recent.push(reply);
        if (META.test(reply)) issues.push("talks about itself or the injection");
        if (kind === "connect" && /\bother (builders|founders|devs)\b|\bus (founders|builders|devs)\b|\bme too\b/.test(reply)) issues.push("claims the user's niche");
        if (kind === "connect" && HOSTILE.test(reply)) issues.push("hostile to a connect post");
        if (kind === "connect" && !/connect|count me in|down|say hi|hey|hi\b|follow|in\b|link up|welcome|let'?s go|yes|sure/.test(reply)) issues.push("doesn't accept the connect");
        results.push({ sample, reply, issues, short: lastShort });
    } catch (err) {
        // The extension shows this as an error with "regenerate"; it's a miss, not a leak.
        const clean = err instanceof Error && /clean reply/.test(err.message);
        results.push({ sample, reply: "", issues: clean ? [] : [`error: ${(err as Error).message}`] });
    }
}

const words = results.map((r) => r.reply.split(/\s+/).filter(Boolean).length).sort((a, b) => a - b);
const median = words[Math.floor(words.length / 2)] ?? 0;
const short = words.filter((w) => w <= 4).length / words.length;
const questions = results.filter((r) => r.reply.includes("?")).length / results.length;
const failed = results.filter((r) => r.issues.length);

console.log(`\nmodel: ${model}, api calls: ${calls} for ${samples.length} posts\n`);
for (const r of results) {
    const context = r.sample.parent
        ? ` (reply to @${r.sample.parent.author})`
        : r.sample.quoted
          ? " (quote)"
          : r.sample.kind === "connect"
            ? " (connect post)"
            : "";
    console.log(`@${r.sample.author}${context}: ${r.sample.text.replace(/\s+/g, " ").slice(0, 90)}`);
    console.log(`  ${r.short ? "→s" : "→ "} ${r.reply}${r.issues.length ? `   ✗ ${r.issues.join(", ")}` : ""}\n`);
}
const connect = results.filter((r) => r.sample.kind === "connect").map((r) => r.reply);
const openers = connect.map((r) => r.split(/\s+/).slice(0, 3).join(" "));
const uniqueConnect = new Set(connect).size === connect.length && new Set(openers).size >= connect.length - 1;

const longOnes = results.filter((r) => r.reply.split(/\s+/).length > 24).length;

const checks = [
    [`replies over 24 words: ${longOnes}`, longOnes === 0],
    [`connect replies all different (openers: ${openers.join(" | ")})`, uniqueConnect],
    [`hard-rule violations: ${failed.length}`, failed.length === 0],
    [`median words: ${median} (want ≤ 12)`, median <= 12],
    [`replies ≤ 4 words: ${Math.round(short * 100)}% (want ≥ 20%)`, short >= 0.2],
    [`replies with "?": ${Math.round(questions * 100)}% (want ≤ 15%)`, questions <= 0.15],
] as const;
for (const [label, ok] of checks) console.log(`${ok ? "✓" : "✗"} ${label}`);
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);

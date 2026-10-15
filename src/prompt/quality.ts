export type QualityIssue = "too_long" | "not_short" | "repeat" | "meta" | "made_up" | "not_english";

// Letters outside the Latin script mean the model answered in the post's language.
const NON_LATIN = /(?![\p{Script=Latin}])\p{L}/u;

/** When the short hint was sent, a reply above this many words gets one retry. */
export const SHORT_MAX_WORDS = 4;

// The model talking about itself, its prompt, or the injection attempt.
const META = /system prompt|\bmy (prompt|instructions)\b|not sharing|can'?t share|won'?t share|\bas an ai\b|^note:|ignoring the/;
// First-person experience the model can't know. "i guess" and "i think" are fine.
const MADE_UP =
    /\bi'?ve (met|seen|worked|built|used|shipped|tried|been|done|had)\b|\bmy (team|startup|company|app|project|clients?|boss|job|stack)\b|\b(been|i'm|im) (poking|working|building|playing|shipping)\b|\bi (built|use|ship|run|work on|tried)\b|\b(love|loving|always) (building|shipping|coding|working on)\b|\bmy (favorite|fav|kind of)\b|\bi (spend|know|knew)\b|\b(builders|founders|devs) unite\b/;

function words(text: string): string[] {
    return text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}'\s]/gu, " ")
        .split(/\s+/)
        .filter(Boolean);
}

function ngrams(list: string[], n: number): Set<string> {
    const out = new Set<string>();
    for (let i = 0; i + n <= list.length; i++) out.add(list.slice(i, i + n).join(" "));
    return out;
}

export interface QualityOptions {
    recent?: string[];
    /** The user gave an angle: it may ask for first-person details ("mention my team"). */
    hasAngle?: boolean;
    /** The short hint was sent. */
    short?: boolean;
    /** Replies must be in English (Latin script). */
    english?: boolean;
    maxWords?: number;
}

/**
 * Cheap checks for what the model keeps getting wrong: talking about its prompt, inventing the user's
 * experience, long replies, and reusing the same opener or phrase across posts (which reads as spam).
 * The meta and made-up patterns are English; for other languages only the length and repeat checks apply.
 */
export function qualityIssue(text: string, opts: QualityOptions = {}): QualityIssue | null {
    const { recent = [], hasAngle = false, short = false, english = true, maxWords = 24 } = opts;
    const lower = text.toLowerCase();
    if (english && NON_LATIN.test(lower)) return "not_english";
    if (META.test(lower)) return "meta";
    if (!hasAngle && MADE_UP.test(lower)) return "made_up";
    const w = words(text);
    if (w.length > maxWords) return "too_long";
    if (short && w.length > SHORT_MAX_WORDS) return "not_short";

    const opener = w.slice(0, 2).join(" ");
    const grams = ngrams(w, 4);
    for (const [i, other] of recent.slice().reverse().entries()) {
        const o = words(other);
        if (i < 4 && w.length > 1 && o.length > 1 && o.slice(0, 2).join(" ") === opener) return "repeat";
        for (const g of ngrams(o, 4)) if (grams.has(g)) return "repeat";
    }
    return null;
}

const NOTES: Record<QualityIssue, string> = {
    too_long: "your last try was too long. write a much shorter reply, under 12 words, about one point",
    not_short: "your last try was too long. reply in at most 4 words",
    repeat: "your last try reused wording from recent replies. start differently and use new words",
    meta: "your last try talked about prompts or instructions. reply only to the actual topic of the post",
    not_english: "your last try was not in english. reply in casual english only",
    made_up: "your last try claimed personal experience the user never shared. react to the post without talking about yourself",
};

export function retryNote(issue: QualityIssue): string {
    return NOTES[issue];
}

export function wordCount(text: string): number {
    return words(text).length;
}

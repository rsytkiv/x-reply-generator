import { STORAGE_KEYS } from "../config.ts";
import { DEFAULT_STYLE } from "../prompt/system.ts";
import type { ReplyLanguage, ReplyLength, StyleSettings } from "./types.ts";

export const DEFAULT_STYLE_SETTINGS: StyleSettings = {
    stylePrompt: DEFAULT_STYLE,
    language: "english",
    lowercase: true,
    length: "short",
};

export const MAX_STYLE_CHARS = 8000;

const LANGUAGES: ReplyLanguage[] = ["english", "ukrainian", "same_as_post"];
const LENGTHS: ReplyLength[] = ["short", "medium"];

/** Accepts whatever is in storage and fills in defaults for anything missing or invalid. */
export function normalizeStyle(value: unknown): StyleSettings {
    const v = (value && typeof value === "object" ? value : {}) as Partial<StyleSettings>;
    const prompt = typeof v.stylePrompt === "string" ? v.stylePrompt.trim().slice(0, MAX_STYLE_CHARS) : "";
    return {
        stylePrompt: prompt || DEFAULT_STYLE_SETTINGS.stylePrompt,
        language: LANGUAGES.includes(v.language as ReplyLanguage) ? (v.language as ReplyLanguage) : DEFAULT_STYLE_SETTINGS.language,
        lowercase: typeof v.lowercase === "boolean" ? v.lowercase : DEFAULT_STYLE_SETTINGS.lowercase,
        length: LENGTHS.includes(v.length as ReplyLength) ? (v.length as ReplyLength) : DEFAULT_STYLE_SETTINGS.length,
    };
}

export function styleFromStorage(data: Record<string, unknown>): StyleSettings {
    return normalizeStyle(data[STORAGE_KEYS.style]);
}

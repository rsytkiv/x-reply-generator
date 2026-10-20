export type MediaKind = "image" | "video" | "gif";

export interface LinkCard {
    domain: string;
    title?: string;
}

export interface QuotedPost {
    author: string;
    text: string;
    media: MediaKind[];
}

export interface ParentPost {
    author: string;
    text: string;
}

/** Everything we send to the model about one post. Built from the DOM or pasted text. */
export interface PostContext {
    /** X status id, or "paste:<hash>" for manually pasted text. */
    postId: string;
    author: string;
    url?: string;
    text: string;
    truncated: boolean;
    media: MediaKind[];
    link?: LinkCard;
    quoted?: QuotedPost;
    parent?: ParentPost;
    replyingTo?: string[];
}

export type ReplyLanguage = "english" | "ukrainian" | "same_as_post";
export type ReplyLength = "short" | "medium";

/** How replies should sound. Edited on the options page, one per Chrome profile. */
export interface StyleSettings {
    /** Free-form style guide (tone, rules, examples). Goes inside <style> in the system prompt. */
    stylePrompt: string;
    /** Facts the user shares about themselves (role, projects, opinions). Goes inside <about_user>. Empty = none. */
    aboutMe: string;
    language: ReplyLanguage;
    lowercase: boolean;
    length: ReplyLength;
}

export interface ReplyVariant {
    text: string;
    createdAt: number;
}

export interface CacheEntry {
    postId: string;
    preview: string;
    variants: ReplyVariant[];
    selected: number;
    createdAt: number;
    lastUsedAt: number;
}

export type ErrorCode =
    | "no_key"
    | "bad_key"
    | "rate_limited"
    | "overloaded"
    | "network"
    | "timeout"
    | "refusal"
    | "truncated"
    | "empty"
    | "bad_request"
    | "unknown";

export interface ReplyError {
    code: ErrorCode;
    message: string;
}

/** Messages from UI (content script, popup) to the service worker over a port. */
export type UiRequest =
    | { type: "get"; ctx: PostContext; angle?: string }
    | { type: "regenerate"; ctx: PostContext; angle?: string }
    | { type: "select"; ctx: PostContext; angle?: string; index: number };

export type UiResponse =
    | { type: "result"; entry: CacheEntry; fromCache: boolean }
    | { type: "error"; error: ReplyError };

/** One-shot messages over chrome.runtime.sendMessage (options page, popup). */
export type RuntimeMessage =
    | { type: "test-key" }
    | { type: "generate-style"; description: string; samples: string; language: ReplyLanguage }
    | { type: "preview"; style: StyleSettings; text: string }
    | { type: "cache-stats" }
    | { type: "cache-clear" }
    | { type: "open-options" };

export const PORT_NAME = "xrg-reply";

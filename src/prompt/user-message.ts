import type { MediaKind, PostContext } from "../shared/types.ts";

/** Stop post text from closing or opening our own tags. */
export function escapeTags(text: string): string {
    return text.replace(/</g, "‹").replace(/>/g, "›");
}

function mediaMarkers(media: MediaKind[]): string {
    return media.map((m) => `[${m}]`).join(" ");
}

function line(author: string, text: string, extra = ""): string {
    const body = [escapeTags(text.trim()), extra].filter(Boolean).join(" ");
    return `@${escapeTags(author)}: ${body}`;
}

export interface MessageOptions {
    angle?: string;
    /** Earlier variants for this same post (Regenerate). */
    previous?: string[];
    /** Replies made on other posts, to avoid repeating wording. */
    recent?: string[];
    /** Ask for a 1-4 word reaction this time. */
    short?: boolean;
    /** Correction for the one automatic retry. */
    note?: string;
}

export function buildUserMessage(ctx: PostContext, opts: MessageOptions = {}): string {
    const { angle, previous = [], recent = [], short = false, note } = opts;
    const parts: string[] = ["<post>"];

    if (ctx.parent) {
        parts.push(`<parent>${line(ctx.parent.author, ctx.parent.text)}</parent>`);
    } else if (ctx.replyingTo?.length) {
        parts.push(`<parent>replying to ${ctx.replyingTo.map(escapeTags).join(" ")}, text not available</parent>`);
    }

    const extras: string[] = [];
    if (ctx.media.length) extras.push(mediaMarkers(ctx.media));
    if (ctx.link) {
        const title = ctx.link.title ? ` "${escapeTags(ctx.link.title)}"` : "";
        extras.push(`[link: ${escapeTags(ctx.link.domain)}${title}]`);
    }
    if (ctx.truncated) extras.push("(text cut off)");

    parts.push(`<target>${line(ctx.author, ctx.text, extras.join(" "))}`);
    if (ctx.quoted) {
        parts.push(`<quoted>${line(ctx.quoted.author, ctx.quoted.text, mediaMarkers(ctx.quoted.media))}</quoted>`);
    }
    parts.push("</target>", "</post>");

    const cleanAngle = angle?.trim();
    if (cleanAngle) parts.push(`<angle>${escapeTags(cleanAngle)}</angle>`);

    if (previous.length) {
        parts.push("<previous_replies>", ...previous.map((p) => `- ${escapeTags(p)}`), "</previous_replies>");
    }

    if (recent.length) {
        parts.push("<recent_replies>", ...recent.map((r) => `- ${escapeTags(r)}`), "</recent_replies>");
    }

    if (short) parts.push(`<length>this time reply in at most 4 words, like "truee", "fair point", "nah not by 2027"</length>`);
    if (note) parts.push(`<note>${escapeTags(note)}</note>`);

    return parts.join("\n");
}

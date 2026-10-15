const WRAPPING_QUOTES = /^["'“”‘’`]+|["'“”‘’`]+$/g;

/** Enforce the hard style rules in code, so a slip from the model never reaches the user. */
export function postprocess(raw: string, opts: { lowercase: boolean } = { lowercase: true }): string {
    let text = raw.trim();

    // Keep only the first paragraph: the model sometimes adds a note after a blank line.
    text = text.split(/\n\s*\n/)[0] ?? "";
    text = text.replace(/\s*\n\s*/g, " ");

    text = text.replace(WRAPPING_QUOTES, "").trim();
    if (opts.lowercase) text = text.toLowerCase();

    // Em/en dashes (with or without spaces around) become a comma.
    text = text.replace(/\s*[—–]\s*/g, ", ");
    text = text.replace(/,\s*,/g, ",").replace(/^,\s*/, "").replace(/,\s*$/, "");

    // Casual lowercase style: a single final period goes, "..." and "?" stay.
    if (opts.lowercase && /[^.]\.$/.test(text)) text = text.slice(0, -1);

    return text.replace(/\s{2,}/g, " ").trim();
}

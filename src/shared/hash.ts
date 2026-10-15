export async function sha256(text: string): Promise<string> {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Trim and collapse whitespace so cosmetic DOM differences don't change cache keys. */
export function normalize(text: string | undefined): string {
    return (text ?? "").replace(/\s+/g, " ").trim();
}

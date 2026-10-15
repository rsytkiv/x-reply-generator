import { RECENT, STORAGE_KEYS } from "../config.ts";
import type { KeyValueStore } from "./storage.ts";

/** The last few replies across all posts, newest last. Helps the model avoid saying the same thing twice. */
export class RecentReplies {
    constructor(private store: KeyValueStore) {}

    async list(): Promise<string[]> {
        const value = (await this.store.get(STORAGE_KEYS.recent))[STORAGE_KEYS.recent];
        return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
    }

    async forPrompt(): Promise<string[]> {
        return (await this.list()).slice(-RECENT.inPrompt);
    }

    async push(text: string): Promise<void> {
        const list = (await this.list()).filter((t) => t !== text);
        list.push(text);
        await this.store.set({ [STORAGE_KEYS.recent]: list.slice(-RECENT.keep) });
    }

    async clear(): Promise<void> {
        await this.store.remove(STORAGE_KEYS.recent);
    }
}

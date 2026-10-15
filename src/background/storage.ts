/** The subset of chrome.storage.local we use. Tests pass an in-memory version. */
export interface KeyValueStore {
    get(keys: string | string[] | null): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
    remove(keys: string | string[]): Promise<void>;
}

export function memoryStore(initial: Record<string, unknown> = {}): KeyValueStore {
    const data = new Map(Object.entries(initial));
    return {
        async get(keys) {
            const list = keys === null ? [...data.keys()] : Array.isArray(keys) ? keys : [keys];
            const out: Record<string, unknown> = {};
            for (const k of list) if (data.has(k)) out[k] = structuredClone(data.get(k));
            return out;
        },
        async set(items) {
            for (const [k, v] of Object.entries(items)) data.set(k, structuredClone(v));
        },
        async remove(keys) {
            for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k);
        },
    };
}

import { PORT_NAME, type UiRequest, type UiResponse } from "../shared/types.ts";

/** Request/response over a long-lived port. Reconnects if the service worker restarted. */
export function createClient() {
    let port: chrome.runtime.Port | null = null;
    let nextId = 1;
    const waiting = new Map<number, (r: UiResponse) => void>();

    const connect = (): chrome.runtime.Port => {
        if (port) return port;
        const p = chrome.runtime.connect({ name: PORT_NAME });
        p.onMessage.addListener((msg: UiResponse & { id: number }) => {
            waiting.get(msg.id)?.(msg);
            waiting.delete(msg.id);
        });
        p.onDisconnect.addListener(() => {
            port = null;
            for (const resolve of waiting.values()) {
                resolve({ type: "error", error: { code: "unknown", message: "extension restarted, try again" } });
            }
            waiting.clear();
        });
        port = p;
        return p;
    };

    return {
        request(msg: UiRequest): Promise<UiResponse> {
            return new Promise((resolve) => {
                const id = nextId++;
                waiting.set(id, resolve);
                try {
                    connect().postMessage({ ...msg, id });
                } catch {
                    waiting.delete(id);
                    // Happens after the extension is reloaded: this page's content script is orphaned.
                    resolve({ type: "error", error: { code: "unknown", message: "extension was updated, reload the page" } });
                }
            });
        },
        disconnect() {
            port?.disconnect();
            port = null;
        },
    };
}

export type Client = ReturnType<typeof createClient>;

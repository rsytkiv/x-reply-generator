import { DEFAULT_MODEL, MODELS, STORAGE_KEYS } from "../config.ts";
import { DEFAULT_STYLE_SETTINGS, normalizeStyle, styleFromStorage } from "../shared/style-settings.ts";
import type { ReplyLanguage, ReplyLength, RuntimeMessage, StyleSettings } from "../shared/types.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const keyInput = $<HTMLInputElement>("key");
const modelSelect = $<HTMLSelectElement>("model");
const apiMsg = $<HTMLSpanElement>("api-msg");
const testBtn = $<HTMLButtonElement>("test");

const describeInput = $<HTMLTextAreaElement>("describe");
const samplesInput = $<HTMLTextAreaElement>("samples");
const generateBtn = $<HTMLButtonElement>("generate");
const genMsg = $<HTMLSpanElement>("gen-msg");
const languageSelect = $<HTMLSelectElement>("language");
const lengthSelect = $<HTMLSelectElement>("length");
const lowercaseBox = $<HTMLInputElement>("lowercase");
const stylePrompt = $<HTMLTextAreaElement>("style-prompt");
const styleMsg = $<HTMLSpanElement>("style-msg");
const tryPost = $<HTMLTextAreaElement>("try-post");
const tryBtn = $<HTMLButtonElement>("try");
const tryMsg = $<HTMLSpanElement>("try-msg");
const tryReply = $<HTMLDivElement>("try-reply");

const cacheMsg = $<HTMLSpanElement>("cache-msg");
const clearBtn = $<HTMLButtonElement>("clear");

type Reply = { ok: boolean; message?: string; style?: string; reply?: string };

function say(target: HTMLElement, text: string, kind: "ok" | "err" | "" = ""): void {
    target.textContent = text;
    target.className = `msg ${kind}`;
}

function send(msg: RuntimeMessage): Promise<Reply> {
    return chrome.runtime.sendMessage(msg) as Promise<Reply>;
}

/** Runs an async action with the button disabled and a status line. */
async function busy(button: HTMLButtonElement, status: HTMLElement, label: string, action: () => Promise<void>): Promise<void> {
    button.disabled = true;
    say(status, label);
    try {
        await action();
    } finally {
        button.disabled = false;
    }
}

for (const [id, info] of Object.entries(MODELS)) {
    modelSelect.append(new Option(info.label, id));
}

function formStyle(): StyleSettings {
    return normalizeStyle({
        stylePrompt: stylePrompt.value,
        language: languageSelect.value as ReplyLanguage,
        length: lengthSelect.value as ReplyLength,
        lowercase: lowercaseBox.checked,
    });
}

function fillStyle(style: StyleSettings): void {
    stylePrompt.value = style.stylePrompt;
    languageSelect.value = style.language;
    lengthSelect.value = style.length;
    lowercaseBox.checked = style.lowercase;
}

async function load(): Promise<void> {
    const data = await chrome.storage.local.get([STORAGE_KEYS.apiKey, STORAGE_KEYS.model, STORAGE_KEYS.style]);
    keyInput.value = (data[STORAGE_KEYS.apiKey] as string | undefined) ?? "";
    modelSelect.value = (data[STORAGE_KEYS.model] as string | undefined) ?? DEFAULT_MODEL;
    fillStyle(styleFromStorage(data));
    if (!keyInput.value) keyInput.focus();
    await refreshCount();
}

async function refreshCount(): Promise<void> {
    const res = (await chrome.runtime.sendMessage({ type: "cache-stats" })) as { count: number };
    say(cacheMsg, `${res.count} saved`);
    clearBtn.disabled = res.count === 0;
}

async function saveKey(): Promise<boolean> {
    const key = keyInput.value.trim();
    if (key && !key.startsWith("sk-ant-")) {
        say(apiMsg, "that doesn't look like an anthropic api key (sk-ant-…)", "err");
        return false;
    }
    await chrome.storage.local.set({ [STORAGE_KEYS.apiKey]: key, [STORAGE_KEYS.model]: modelSelect.value });
    return true;
}

$("save-key").addEventListener("click", async () => {
    if (await saveKey()) say(apiMsg, "saved", "ok");
});

testBtn.addEventListener("click", () =>
    busy(testBtn, apiMsg, "testing…", async () => {
        if (!(await saveKey())) return;
        const res = await send({ type: "test-key" });
        say(apiMsg, res.ok ? "key works" : (res.message ?? "failed"), res.ok ? "ok" : "err");
    }),
);

generateBtn.addEventListener("click", () =>
    busy(generateBtn, genMsg, "writing your style… (10–30 s)", async () => {
        if (!describeInput.value.trim() && !samplesInput.value.trim()) {
            say(genMsg, "describe your replies or paste a few first", "err");
            describeInput.focus();
            return;
        }
        const res = await send({
            type: "generate-style",
            description: describeInput.value,
            samples: samplesInput.value,
            language: languageSelect.value as ReplyLanguage,
        });
        if (!res.ok || !res.style) {
            say(genMsg, res.message ?? "failed", "err");
            return;
        }
        stylePrompt.value = res.style;
        say(genMsg, "done. read it, try it, then save", "ok");
        stylePrompt.scrollIntoView({ behavior: "smooth", block: "center" });
    }),
);

tryBtn.addEventListener("click", () =>
    busy(tryBtn, tryMsg, "thinking…", async () => {
        tryReply.textContent = "";
        if (!tryPost.value.trim()) {
            say(tryMsg, "paste a post first", "err");
            tryPost.focus();
            return;
        }
        const res = await send({ type: "preview", style: formStyle(), text: tryPost.value });
        if (!res.ok || !res.reply) {
            say(tryMsg, res.message ?? "failed", "err");
            return;
        }
        say(tryMsg, "");
        tryReply.textContent = res.reply;
    }),
);

$("save-style").addEventListener("click", async () => {
    const style = formStyle();
    await chrome.storage.local.set({ [STORAGE_KEYS.style]: style });
    fillStyle(style);
    say(styleMsg, "saved. new replies use this style", "ok");
});

$("reset-style").addEventListener("click", () => {
    if (!confirm("Replace the style with the default one? Your current text will be lost unless you copy it.")) return;
    fillStyle(DEFAULT_STYLE_SETTINGS);
    say(styleMsg, "default loaded. press save to use it");
});

clearBtn.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "cache-clear" });
    await refreshCount();
});

void load();

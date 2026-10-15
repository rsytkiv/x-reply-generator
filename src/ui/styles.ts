// Colors follow X's own light/dark palettes so the panel feels native.
export const PANEL_CSS = `
.xrg-panel {
    --bg: #ffffff; --fg: #0f1419; --muted: #536471; --line: #cfd9de; --soft: #f7f9f9;
    --accent: #1d9bf0; --accent-fg: #ffffff; --danger: #f4212e; --ok: #00ba7c;
    box-sizing: border-box; width: 340px; max-width: calc(100vw - 32px);
    padding: 12px; border: 1px solid var(--line); border-radius: 16px;
    background: var(--bg); color: var(--fg);
    font: 14px/1.4 TwitterChirp, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.18);
    display: flex; flex-direction: column; gap: 8px;
}
.xrg-panel.xrg-dark {
    --bg: #000000; --fg: #e7e9ea; --muted: #71767b; --line: #2f3336; --soft: #16181c;
    box-shadow: 0 0 15px rgba(255, 255, 255, 0.12), 0 0 3px 1px rgba(255, 255, 255, 0.08);
}
.xrg-panel *, .xrg-panel *::before, .xrg-panel *::after { box-sizing: border-box; }
.xrg-panel [hidden] { display: none !important; }

.xrg-head { position: relative; padding-right: 24px; }
.xrg-author { font-weight: 700; font-size: 13px; }
.xrg-preview { color: var(--muted); font-size: 13px; overflow-wrap: anywhere; white-space: pre-line;
    display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3; overflow: hidden; }
.xrg-parent { color: var(--muted); font-size: 12px; margin-top: 4px; padding-left: 8px; border-left: 2px solid var(--line);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.xrg-badges { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.xrg-badges:empty { display: none; }
.xrg-badge { font-size: 11px; color: var(--muted); background: var(--soft); border: 1px solid var(--line);
    border-radius: 999px; padding: 1px 8px; }
.xrg-close { position: absolute; top: -4px; right: -4px; width: 28px; height: 28px; border: 0; border-radius: 50%;
    background: transparent; color: var(--fg); font-size: 20px; line-height: 1; cursor: pointer; }
.xrg-close:hover { background: var(--soft); }

.xrg-status { color: var(--muted); font-size: 13px; min-height: 0; }
.xrg-status:empty { display: none; }
.xrg-busy .xrg-status::before { content: ""; display: inline-block; width: 10px; height: 10px; margin-right: 6px;
    border: 2px solid var(--line); border-top-color: var(--accent); border-radius: 50%; vertical-align: -1px;
    animation: xrg-spin 0.8s linear infinite; }
@keyframes xrg-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .xrg-busy .xrg-status::before { animation: none; } }

.xrg-text { width: 100%; resize: vertical; min-height: 64px; padding: 8px 10px; border: 1px solid var(--line);
    border-radius: 8px; background: var(--bg); color: var(--fg); font: inherit; font-size: 15px; }
.xrg-text:focus, .xrg-angle:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.xrg-busy .xrg-text { opacity: 0.5; }

.xrg-actions { display: flex; align-items: center; gap: 6px; }
.xrg-spacer { flex: 1; }
.xrg-variants { display: flex; align-items: center; gap: 2px; color: var(--muted); font-size: 12px; }
.xrg-nav { width: 26px; height: 26px; border: 0; border-radius: 50%; background: transparent; color: var(--fg);
    font-size: 16px; cursor: pointer; }
.xrg-nav:hover:not(:disabled) { background: var(--soft); }
.xrg-nav:disabled { opacity: 0.35; cursor: default; }
.xrg-counter { min-width: 26px; text-align: center; font-variant-numeric: tabular-nums; }

.xrg-panel button.xrg-primary, .xrg-panel button.xrg-secondary { height: 32px; padding: 0 14px; border-radius: 999px;
    font: inherit; font-weight: 700; font-size: 14px; cursor: pointer; white-space: nowrap; }
.xrg-primary { border: 0; background: var(--fg); color: var(--bg); }
.xrg-primary.xrg-copied { background: var(--ok); color: #fff; }
.xrg-secondary { border: 1px solid var(--line); background: transparent; color: var(--fg); }
.xrg-secondary:hover:not(:disabled) { background: var(--soft); }
.xrg-panel button:disabled { opacity: 0.5; cursor: default; }
.xrg-panel button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.xrg-error { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 8px;
    color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, transparent); font-size: 13px; }
.xrg-error span { flex: 1; }

.xrg-link { align-self: flex-start; border: 0; background: none; padding: 2px 0; color: var(--accent);
    font: inherit; font-size: 13px; cursor: pointer; }
.xrg-link:hover { text-decoration: underline; }
.xrg-angle-row { display: flex; gap: 6px; }
.xrg-angle { flex: 1; min-width: 0; height: 32px; padding: 0 10px; border: 1px solid var(--line); border-radius: 8px;
    background: var(--bg); color: var(--fg); font: inherit; font-size: 13px; }
`;

export const BUTTON_CSS = `
.xrg-trigger { display: inline-flex; align-items: center; gap: 4px; height: 28px; padding: 0 10px; margin: 0 4px;
    border: 1px solid rgb(83, 100, 113, 0.35); border-radius: 999px; background: transparent; color: rgb(29, 155, 240);
    font: 600 13px/1 TwitterChirp, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; cursor: pointer;
    align-self: center; white-space: nowrap; }
.xrg-trigger:hover { background: rgba(29, 155, 240, 0.1); }
.xrg-trigger:focus-visible { outline: 2px solid rgb(29, 155, 240); outline-offset: 2px; }
`;

import * as esbuild from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const watch = process.argv.includes("--watch");
const outdir = "dist";

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const options = {
    entryPoints: {
        background: "src/background/index.ts",
        content: "src/content/index.ts",
        popup: "src/popup/popup.ts",
        options: "src/options/options.ts",
    },
    bundle: true,
    format: "esm",
    target: "chrome120",
    outdir,
    sourcemap: watch ? "inline" : false,
    minify: !watch,
    logLevel: "info",
};

// Content scripts can't be ES modules, so bundle it as an IIFE separately.
const contentOptions = {
    ...options,
    entryPoints: { content: "src/content/index.ts" },
    format: "iife",
};
delete options.entryPoints.content;

await cp("public", outdir, { recursive: true });
// The version lives in package.json only; the built manifest gets it from there.
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
await writeFile(`${outdir}/manifest.json`, JSON.stringify({ ...manifest, version: pkg.version }, null, 4));
await cp("src/popup/popup.html", `${outdir}/popup.html`);
await cp("src/options/options.html", `${outdir}/options.html`);

if (watch) {
    const ctxs = await Promise.all([esbuild.context(options), esbuild.context(contentOptions)]);
    await Promise.all(ctxs.map((ctx) => ctx.watch()));
} else {
    await Promise.all([esbuild.build(options), esbuild.build(contentOptions)]);
}

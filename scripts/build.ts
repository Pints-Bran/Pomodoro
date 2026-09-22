import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

mkdirSync("dist", { recursive: true });
for (const config of ["tsconfig.app.json", "tsconfig.worker.json"]) {
  execFileSync(
    process.execPath,
    ["node_modules/typescript/bin/tsc", "-p", config],
    { stdio: "inherit" },
  );
}
for (const file of [
  "index.html",
  "style.css",
  "manifest.webmanifest",
  "icons",
]) {
  cpSync(file, `dist/${file}`, { recursive: true });
}
// Every changed release gets a new cache, without manually bumping a version.
const assets: string[] = [
  "index.html",
  "style.css",
  "manifest.webmanifest",
  "app.js",
  "audio.js",
  "dom.js",
  "pwa.js",
  "sw.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png",
  "icons/apple-touch-icon.png",
];
const hash = createHash("sha256");
for (const asset of assets) hash.update(readFileSync(`dist/${asset}`));
const worker = readFileSync("dist/sw.js", "utf8").replace(
  "__BUILD_VERSION__",
  hash.digest("hex").slice(0, 16),
);
writeFileSync("dist/sw.js", worker);
console.log("Built Still into dist/.");

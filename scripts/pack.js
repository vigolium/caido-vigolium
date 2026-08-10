import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");

// The installable package lives at the repo root and is committed, mirroring
// burp-vigolium.jar, so it can be downloaded straight from the repository
// without cloning or building.
const PACKAGE_NAME = "caido-vigolium.zip";

const manifestPath = path.join(ROOT, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

// Fail loudly if a declared entrypoint was not produced - a package that
// installs but silently has no backend is far harder to debug than a failed build.
for (const plugin of manifest.plugins) {
  const entry = path.join(DIST, plugin.entrypoint);
  if (!fs.existsSync(entry)) {
    console.error(`[-] Missing entrypoint for "${plugin.id}": ${plugin.entrypoint}`);
    process.exit(1);
  }
  if (plugin.style) {
    const style = path.join(DIST, plugin.style);
    if (!fs.existsSync(style)) {
      // Vite omits the stylesheet when no component imports CSS. Emit an empty
      // one so the manifest stays honest.
      fs.mkdirSync(path.dirname(style), { recursive: true });
      fs.writeFileSync(style, "");
      console.log(`[*] Created empty ${plugin.style}`);
    }
  }
}

fs.copyFileSync(manifestPath, path.join(DIST, "manifest.json"));
console.log("[*] Copied manifest.json");

const zipPath = path.join(ROOT, PACKAGE_NAME);
// `zip` appends to an existing archive, so a stale entry from a previous build
// would otherwise survive into the new package.
if (fs.existsSync(zipPath)) fs.rmSync(zipPath);

execFileSync("zip", ["-qr", zipPath, "manifest.json", "backend", "frontend"], {
  cwd: DIST,
  stdio: "inherit",
});

const { size } = fs.statSync(zipPath);
console.log(`[+] ${PACKAGE_NAME} (${(size / 1024).toFixed(1)} KiB) - v${manifest.version}`);

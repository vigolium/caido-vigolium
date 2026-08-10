import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");

// The Caido store requires the release asset to be named exactly
// `plugin_package.zip` (plus a detached `plugin_package.zip.sig`), so that is
// the canonical artifact and it is built into dist/.
const STORE_PACKAGE_NAME = "plugin_package.zip";

// A byte-identical copy also lives at the repo root and is committed, mirroring
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

const storeZipPath = path.join(DIST, STORE_PACKAGE_NAME);
const zipPath = path.join(ROOT, PACKAGE_NAME);
// `zip` appends to an existing archive, so a stale entry from a previous build
// would otherwise survive into the new package.
for (const stale of [storeZipPath, zipPath]) {
  if (fs.existsSync(stale)) fs.rmSync(stale);
}

execFileSync("zip", ["-qr", storeZipPath, "manifest.json", "backend", "frontend"], {
  cwd: DIST,
  stdio: "inherit",
});

// The root package is a copy rather than a second `zip` run so the file users
// download is bit-for-bit the archive that was signed for the store.
fs.copyFileSync(storeZipPath, zipPath);

const { size } = fs.statSync(storeZipPath);
const kib = (size / 1024).toFixed(1);
console.log(`[+] dist/${STORE_PACKAGE_NAME} (${kib} KiB) - v${manifest.version}`);
console.log(`[+] ${PACKAGE_NAME} (${kib} KiB) - copy of dist/${STORE_PACKAGE_NAME}`);

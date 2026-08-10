import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// The packaged zip is a committed release artifact, so `clean` removes only the
// intermediate build output and leaves it in place.
const dist = path.join(ROOT, "dist");
if (fs.existsSync(dist)) {
  fs.rmSync(dist, { recursive: true, force: true });
  console.log("[*] Removed dist");
}

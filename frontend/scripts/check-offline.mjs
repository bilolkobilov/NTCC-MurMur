// Fails if the built site would load anything from the internet. The demo laptop has no internet.
//   node scripts/check-offline.mjs            (run after `npm run build`)
import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const files = readdirSync(dist, { recursive: true }).map(String);
const problems = [];

// HTML/CSS: any absolute URL that is not inside a comment (licence banners are comments) is a load.
const absolute = /(?:src|href)\s*=\s*["']?(?:https?:)?\/\/|url\(\s*["']?(?:https?:)?\/\/|@import\s+["']?(?:https?:)?\/\//gi;
// JS: libraries carry documentation links in strings, so look for loads and for known CDN hosts only.
const jsLoad = /(?:fetch|import)\(\s*["'`]https?:\/\/|fonts\.googleapis|fonts\.gstatic|cdnjs\.cloudflare|cdn\.jsdelivr|unpkg\.com/gi;

for (const file of files) {
  const ext = extname(file);
  if (![".html", ".css", ".js"].includes(ext)) continue;
  let text = readFileSync(join(dist, file), "utf8");
  if (ext === ".css") text = text.replace(/\/\*[\s\S]*?\*\//g, "");
  if (ext === ".html") text = text.replace(/<!--[\s\S]*?-->/g, "");
  for (const match of text.matchAll(ext === ".js" ? jsLoad : absolute)) {
    problems.push(`${file}: ${text.slice(Math.max(0, match.index - 30), match.index + 60).replace(/\s+/g, " ")}`);
  }
}

for (const problem of problems) console.log(`FAIL ${problem}`);
console.log(problems.length ? `${problems.length} external load(s) found` : `OFFLINE OK (${files.length} files checked)`);
process.exit(problems.length ? 1 : 0);

// PreToolUse hook: stops Claude from reading the project's real secret files.
// The list lives next to this folder in .claude/secret-files.txt — one repo-relative path per line, `*` matches any
// characters inside one path segment, `#` starts a comment. Exit 2 blocks the call; the message goes back to Claude.
// Writing a secret file and naming one in a command that does not read it (a docker -v mount, an env var) stay allowed.
import { readFileSync } from "node:fs";

const listFile = new URL("../secret-files.txt", import.meta.url);
let patterns = [];
try {
  patterns = readFileSync(listFile, "utf8").split(/\r?\n/).map((line) => line.replace(/#.*/, "").trim()).filter(Boolean);
} catch {
  process.exit(0); // no list → nothing to protect
}
if (patterns.length === 0) process.exit(0);

const escape = (text) => text.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
const toRegex = (pattern) => pattern.split("/").map((part) => escape(part).replaceAll("*", "[^\\s\"'/\\\\]*")).join("[/\\\\]");
// The path may follow a space, quote, `=`, `/`, `\`, `:` (git show HEAD:path) or `<` (cat<file).
const SECRET = new RegExp(`(^|[\\s"'=:</\\\\])(${patterns.map(toRegex).join("|")})(?=$|[\\s"'),;|&>])`, "i");
const READS = /\b(cat|head|tail|less|more|type|sed|awk|grep|rg|findstr|strings|xxd|od|base64|bat|Get-Content|gc|Select-String|cp|copy|scp|Copy-Item|python3?|py|pwsh|powershell|ruby|perl|php|jq|sort|uniq|diff|cut|nl|tac|vim?|nano|code|notepad)\b|\bgit\s+(diff|show|log\s+-p|blame|grep)\b|\bnode\s+-(e|p)\b|readFileSync|import\(/i;

let raw = "";
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  let call;
  try {
    call = JSON.parse(raw);
  } catch {
    process.exit(0);
  }
  const input = call.tool_input ?? {};
  const tool = call.tool_name ?? "";
  const paths = [input.file_path, input.path, input.notebook_path].filter((p) => typeof p === "string");
  const hitPath = paths.some((p) => SECRET.test(" " + p.replaceAll("\\", "/")));
  const command = typeof input.command === "string" ? input.command : "";
  // Only a read in the same pipeline step as the secret path counts: `X=config/test.ts npm test | tail` is fine.
  const hitCommand = command.split(/\|\||&&|[|;&\n]/).some((step) => SECRET.test(step) && (READS.test(step) || /</.test(step)));
  const blockedTool = ["Read", "Grep", "NotebookRead", "Edit", "MultiEdit"].includes(tool) && hitPath;
  if (blockedTool || hitCommand) {
    process.stderr.write(
      "Blocked: this is a real secret file (.claude/secret-files.txt). Read the example/template file for key names, " +
        "or report only <set> / <missing>.\n",
    );
    process.exit(2);
  }
  process.exit(0);
});

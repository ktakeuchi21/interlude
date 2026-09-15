import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

// Review the exact tracked source snapshot; older commits need separate review.
// Only filenames/rule names are printed; never print a matched credential.
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const errors = [];
const rules = [
  ["provider key", /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{24,}|gh[opusr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{30,}|AIza[A-Za-z0-9_-]{30,})\b/],
  ["private key material", /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----\s+[A-Za-z0-9+/=\s]{80,}-----END/],
  ["private Site identity", /\bappg(?:prj|dep|ver)_[a-f0-9]{24,}\b/],
  ["local personal path", /\/Users\/[A-Za-z0-9][^\s"'<>]*/],
];
for (const file of files) {
  if ((/(^|\/)\.env(?:\.|$)/.test(file) && file !== ".env.example") || /(^|\/)\.dev\.vars/.test(file) || /\.(?:pem|key|p12|pfx|sqlite(?:3)?|db|wav|mp3|mp4|mov|zip|tar\.gz)$/i.test(file)) errors.push(`${file}: runtime or credential file`);
  if (statSync(file).size > 2_000_000) errors.push(`${file}: large artifact requires review`);
  if (/\.(png|jpg|jpeg|webp|ico)$/i.test(file)) continue;
  const source = readFileSync(file, "utf8");
  for (const [name, pattern] of rules) if (pattern.test(source)) errors.push(`${file}: ${name}`);
}
const hosting = JSON.parse(readFileSync(".openai/hosting.json", "utf8"));
if (hosting.project_id) errors.push(".openai/hosting.json: personal deployment identity");
const publications = JSON.parse(readFileSync("lib/plan-publications.json", "utf8"));
if (!Array.isArray(publications) || publications.length) errors.push("lib/plan-publications.json: public source must not contain owner publications");
if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
else console.log(`Public-source check passed for ${files.length} tracked files.`);

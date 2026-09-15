import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { projectRoot } from "./sites-env.mjs";

const built = resolve(projectRoot, "dist/server/wrangler.json");
let config;
try { config = JSON.parse(readFileSync(built, "utf8")); }
catch { throw new Error("Run npm run build before migrating the local database."); }
const binding = config.d1_databases?.find(item => item.binding === "DB");
if (!binding?.database_id) throw new Error("The build has no local DB binding.");
const runtime = resolve(projectRoot, ".sites-runtime");
mkdirSync(runtime, { recursive: true });
const localConfig = resolve(runtime, "local-migrations.json");
writeFileSync(localConfig, JSON.stringify({
  name: "interlude-local-migrations",
  compatibility_date: config.compatibility_date ?? "2026-09-15",
  d1_databases: [{ ...binding, migrations_dir: resolve(projectRoot, "drizzle") }],
}, null, 2));
// Deliberately no remote option. Wrangler records applied migrations locally.
const result = spawnSync(process.execPath, [
  resolve(projectRoot, "node_modules/wrangler/bin/wrangler.js"),
  "d1", "migrations", "apply", "DB", "--local",
  "--config", localConfig, "--persist-to", resolve(projectRoot, ".wrangler/state"),
], { cwd: projectRoot, stdio: "inherit", env: { ...process.env, CI: "true" } });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

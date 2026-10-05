#!/usr/bin/env node
// Runs a command with the variables of a cloud project's env file in its environment
// (`--target verify` = .env.supabase-cloud, the default; `--target demo` = .env.supabase-demo).
// Arguments may contain {VAR} placeholders, replaced from that file. Values are never printed.
//
//   node scripts/with-cloud-env.mjs supabase link --project-ref {SUPABASE_PROJECT_REF}
//   node scripts/with-cloud-env.mjs --target demo supabase db push --db-url {SUPABASE_DB_URL}
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { loadCloudTarget } from './cloud-target.mjs';

const { fileName, args: argv } = loadCloudTarget();
const [cmd, ...rawArgs] = argv;
if (!cmd) {
  console.error('Usage: node scripts/with-cloud-env.mjs <command> [args with {VAR}]');
  process.exit(1);
}

const missing = new Set();
const args = rawArgs.map((arg) =>
  arg.replace(/\{([A-Z0-9_]+)\}/g, (_, name) => {
    const value = process.env[name];
    if (!value) missing.add(name);
    return value ?? '';
  }),
);
if (missing.size) {
  console.error(`Empty in ${fileName}: ${[...missing].join(', ')}`);
  process.exit(1);
}

// No shell: arguments (which may hold secrets with special characters) are passed verbatim.
// `supabase` runs the local CLI from node_modules through node.
const CLI = join(import.meta.dirname, '..', 'node_modules', 'supabase', 'dist', 'supabase.js');
const [bin, finalArgs] = cmd === 'supabase' ? [process.execPath, [CLI, ...args]] : [cmd, args];
const result = spawnSync(bin, finalArgs, { stdio: 'inherit' });
process.exit(result.status ?? 1);

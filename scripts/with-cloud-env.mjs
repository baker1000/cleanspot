#!/usr/bin/env node
// Runs a command with the variables from .env.supabase-cloud in its environment.
// Arguments may contain {VAR} placeholders, replaced from that file. Values are never printed.
//
//   node scripts/with-cloud-env.mjs supabase link --project-ref {SUPABASE_PROJECT_REF}
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const ENV_FILE = join(import.meta.dirname, '..', '.env.supabase-cloud');
if (!existsSync(ENV_FILE)) {
  console.error('Missing .env.supabase-cloud — copy supabase-cloud.env.example and fill it in.');
  process.exit(1);
}
process.loadEnvFile(ENV_FILE);

const [cmd, ...rawArgs] = process.argv.slice(2);
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
  console.error(`Empty in .env.supabase-cloud: ${[...missing].join(', ')}`);
  process.exit(1);
}

// No shell: arguments (which may hold secrets with special characters) are passed verbatim.
// `supabase` runs the local CLI from node_modules through node.
const CLI = join(import.meta.dirname, '..', 'node_modules', 'supabase', 'dist', 'supabase.js');
const [bin, finalArgs] = cmd === 'supabase' ? [process.execPath, [CLI, ...args]] : [cmd, args];
const result = spawnSync(bin, finalArgs, { stdio: 'inherit' });
process.exit(result.status ?? 1);

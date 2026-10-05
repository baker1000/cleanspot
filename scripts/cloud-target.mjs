// Which Supabase cloud project a script works on. Two projects, two git-ignored env files with
// the same variable names (template: supabase-cloud.env.example):
//
//   verify  .env.supabase-cloud  only for `npm run verify:remote` (must stay empty) — default
//   demo    .env.supabase-demo   demo and pitch project: migrations + demo data
//
// Scripts take `--target demo|verify` anywhere in their arguments; it is removed before the
// remaining arguments are used.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const ROOT = join(import.meta.dirname, '..');
export const TARGETS = {
  verify: '.env.supabase-cloud',
  demo: '.env.supabase-demo',
};

/**
 * Reads `--target <name>` from `argv` (default `fallback`) and loads that env file.
 * Returns the target name, the env file's name and path, and `argv` without the option.
 */
export function loadCloudTarget(argv = process.argv.slice(2), fallback = 'verify') {
  const args = [...argv];
  const i = args.indexOf('--target');
  const name = i >= 0 ? args[i + 1] : fallback;
  if (i >= 0) args.splice(i, 2);
  if (!(name in TARGETS)) {
    console.error(`--target must be one of: ${Object.keys(TARGETS).join(', ')}`);
    process.exit(1);
  }
  const fileName = TARGETS[name];
  const file = join(ROOT, fileName);
  if (!existsSync(file)) {
    console.error(`Missing ${fileName} — copy supabase-cloud.env.example to it and fill it in.`);
    process.exit(1);
  }
  process.loadEnvFile(file);
  return { name, fileName, file, args };
}

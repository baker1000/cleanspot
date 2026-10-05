/**
 * DB test harness with two targets:
 *
 *  * `pglite` (default): runs the real migrations in PGlite (Postgres compiled to WASM) with
 *    PostGIS, on a minimal shim of Supabase's `auth`/`storage` schemas and API roles. No Docker.
 *  * `remote` (`DB_TARGET=remote`, see `npm run verify:remote`): runs the same tests against a
 *    real Supabase database (migrations already pushed). Everything a test file does happens
 *    inside ONE transaction that is rolled back at the end, so no test data is left behind.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { postgis } from '@electric-sql/pglite-postgis';
import pg from 'pg';

export const DB_TARGET = process.env.DB_TARGET === 'remote' ? 'remote' : 'pglite';
export const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');
export const CLOUD_ENV_FILE = join(REPO_ROOT, '.env.supabase-cloud');

const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'migrations');

const SUPABASE_SHIM = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create schema extensions;
  grant usage on schema public, auth, extensions to anon, authenticated, service_role;

  create table auth.users (
    id uuid primary key,
    email text,
    is_anonymous boolean not null default false,
    created_at timestamptz not null default now()
  );

  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;
  grant execute on all functions in schema auth to anon, authenticated, service_role;

  -- Minimal Supabase Storage schema (buckets, objects with RLS, foldername()).
  create schema storage;
  grant usage on schema storage to anon, authenticated, service_role;
  create table storage.buckets (
    id text primary key,
    name text not null,
    public boolean default false,
    file_size_limit bigint,
    allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets (id),
    name text not null,
    owner uuid,
    created_at timestamptz default now(),
    unique (bucket_id, name)
  );
  alter table storage.objects enable row level security;
  grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
  grant select on storage.buckets to anon, authenticated, service_role;
  create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
  declare _parts text[];
  begin
    select string_to_array(name, '/') into _parts;
    return _parts[1 : array_length(_parts, 1) - 1];
  end
  $$;
  grant execute on function storage.foldername(text) to anon, authenticated, service_role;

  -- Supabase grants these by default; migrations are expected to narrow them.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
  /** Starts an isolated unit of work (transaction in PGlite, savepoint on remote). */
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  close(): Promise<void>;
}

async function createPgliteDb(): Promise<Db> {
  const lite = new PGlite({ extensions: { postgis } });
  await lite.exec(SUPABASE_SHIM);
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    try {
      await lite.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
  }
  // Session-level so it survives `set local role`.
  await lite.exec(`set search_path = public, extensions`);
  return {
    query: (sql, params) => lite.query(sql, params),
    exec: (sql) => lite.exec(sql),
    begin: async () => void (await lite.exec('begin')),
    commit: async () => void (await lite.exec('commit')),
    rollback: async () => void (await lite.exec('rollback')),
    close: () => lite.close(),
  };
}

export function loadCloudEnv() {
  if (!process.env.SUPABASE_DB_URL && existsSync(CLOUD_ENV_FILE))
    process.loadEnvFile(CLOUD_ENV_FILE);
  if (!process.env.SUPABASE_DB_URL) {
    throw new Error(
      `SUPABASE_DB_URL missing: fill in ${CLOUD_ENV_FILE} (see supabase-cloud.env.example)`,
    );
  }
}

export function pgSslOptions(): pg.ClientConfig['ssl'] {
  // Encrypted always. Certificate verification needs Supabase's CA file (Dashboard ->
  // Database -> SSL); without it the connection is encrypted but the server is not verified.
  const ca = process.env.SUPABASE_DB_CA_CERT;
  return ca ? { ca: readFileSync(ca, 'utf8') } : { rejectUnauthorized: false };
}

async function createRemoteDb(): Promise<Db> {
  loadCloudEnv();
  const client = new pg.Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: pgSslOptions(),
  });
  await client.connect();

  // The tests create their own tenants and take over the public tenant (created by migration).
  // Refuse to run on a database that already has real tenants or reports instead of silently
  // mixing with real data.
  const existing = await client.query(
    `select slug from public.tenants where slug not like 'verify-%' and kind <> 'public'
     union all
     select 'reports' where exists (select 1 from public.reports)`,
  );
  if (existing.rowCount) {
    await client.end();
    throw new Error(
      `Remote DB already has data (${existing.rows.map((r) => r.slug).join(', ')}). ` +
        'Run the verification on an empty project. Demo data: `npm run demo -- remove` first.',
    );
  }

  await client.query('begin');
  await client.query(`set local search_path = public, extensions`);
  return {
    query: async <T>(sql: string, params?: unknown[]) => ({
      rows: (await client.query(sql, params)).rows as T[],
    }),
    exec: (sql) => client.query(sql),
    begin: async () => void (await client.query('savepoint actor')),
    commit: async () => void (await client.query('release savepoint actor')),
    rollback: async () => {
      await client.query('rollback to savepoint actor');
      await client.query('release savepoint actor');
    },
    close: async () => {
      try {
        await client.query('rollback');
      } finally {
        await client.end();
      }
    },
  };
}

export async function createTestDb(): Promise<Db> {
  return DB_TARGET === 'remote' ? createRemoteDb() : createPgliteDb();
}

/** Creates an auth user (the profile is created by trigger). */
export async function createUser(db: Db, id: string, opts: { anonymous?: boolean } = {}) {
  await db.query(`insert into auth.users (id, is_anonymous) values ($1, $2)`, [
    id,
    opts.anonymous ?? false,
  ]);
}

export interface Actor {
  /** auth.uid(); null = anon role */
  sub: string | null;
  anonymous?: boolean;
  /** Override the API role, e.g. 'service_role' for cron / Edge Function calls. */
  role?: 'anon' | 'authenticated' | 'service_role';
}

/**
 * Runs a query as an API role (like PostgREST does: role + JWT claims as settings) inside a
 * unit of work that is rolled back by default, so tests don't leak state. `commit: true` keeps it.
 */
export async function asActor<T = Record<string, unknown>>(
  db: Db,
  actor: Actor,
  sql: string,
  params: unknown[] = [],
  opts: { commit?: boolean } = {},
): Promise<T[]> {
  const role = actor.role ?? (actor.sub ? 'authenticated' : 'anon');
  const claims = JSON.stringify({ sub: actor.sub, role, is_anonymous: actor.anonymous ?? false });
  await db.begin();
  try {
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [actor.sub ?? '']);
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
    await db.exec(`set local role ${role}`);
    const result = await db.query<T>(sql, params);
    // A released savepoint keeps SET LOCAL values; reset so later setup runs as the owner again.
    await db.exec(`reset role`);
    await db.query(
      `select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true)`,
    );
    await (opts.commit ? db.commit() : db.rollback());
    return result.rows;
  } catch (error) {
    await db.rollback();
    throw error;
  }
}

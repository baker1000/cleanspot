/**
 * Lightweight DB test harness: runs the real migrations in PGlite (Postgres compiled to WASM)
 * with PostGIS, on top of a minimal shim of the Supabase `auth` schema and API roles.
 *
 * This is NOT a substitute for the pgTAP suite against a real Supabase stack (`npm run db:test`,
 * needs Docker). It exists so SQL and RLS logic can be checked on machines without Docker.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { postgis } from '@electric-sql/pglite-postgis';

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

export type Db = PGlite;

export async function createTestDb(): Promise<Db> {
  const db = new PGlite({ extensions: { postgis } });
  await db.exec(SUPABASE_SHIM);
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    try {
      await db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
  }
  // Session-level so it survives `set local role`.
  await db.exec(`set search_path = public, extensions`);
  return db;
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
}

/**
 * Runs a query as an API role inside a transaction that is rolled back by default,
 * so tests don't leak state. Pass `commit: true` to persist.
 */
export async function asActor<T = Record<string, unknown>>(
  db: Db,
  actor: Actor,
  sql: string,
  params: unknown[] = [],
  opts: { commit?: boolean } = {},
): Promise<T[]> {
  const role = actor.sub ? 'authenticated' : 'anon';
  const claims = JSON.stringify({ sub: actor.sub, role, is_anonymous: actor.anonymous ?? false });
  await db.exec('begin');
  try {
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [actor.sub ?? '']);
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
    await db.exec(`set local role ${role}`);
    const result = await db.query<T>(sql, params);
    await db.exec(opts.commit ? 'commit' : 'rollback');
    return result.rows;
  } catch (error) {
    await db.exec('rollback');
    throw error;
  }
}

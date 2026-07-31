import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export const DEFAULT_LOCAL_URL = 'postgresql://contextlens:contextlens@localhost:54329/contextlens';

/**
 * Loads the repo root .env so the scripts see the same configuration the API does.
 * Without this, DATABASE_URL falls back to the local default and a command aimed at
 * a hosted database silently runs against Docker instead, which is the worst possible
 * failure mode for a migration.
 */
export function loadRootEnv() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  try {
    process.loadEnvFile(path.resolve(here, '..', '..', '.env'));
  } catch {
    // No .env present. Real environments supply configuration directly.
  }
}

/**
 * Builds a pg client config. Hosted providers such as Supabase require TLS, while a
 * local Docker instance does not offer it, so the mode is derived from the host rather
 * than configured by hand in two places.
 *
 * Certificate verification stays on by default. Set DATABASE_SSL_REJECT_UNAUTHORIZED
 * to "false" only for a provider whose chain is not in the system trust store.
 */
export function connectionConfig(connectionString = process.env.DATABASE_URL ?? DEFAULT_LOCAL_URL) {
  let hostname;
  try {
    hostname = new URL(connectionString).hostname;
  } catch {
    throw new Error('DATABASE_URL is not a valid connection string');
  }

  if (LOCAL_HOSTS.has(hostname)) {
    return { connectionString };
  }

  // Preferred: verify against the provider's CA. Supabase serves its pooler behind a
  // certificate chain Node does not trust out of the box, and the dashboard offers the
  // CA for download (Project Settings, Database, SSL Configuration).
  const caFile = process.env.DATABASE_SSL_CA_FILE;
  if (caFile) {
    return {
      connectionString,
      ssl: { ca: readFileSync(caFile, 'utf8'), rejectUnauthorized: true },
    };
  }

  // Fallback: encrypted but unverified. Traffic is still TLS, however a machine in the
  // middle could present its own certificate. Acceptable for local development against a
  // throwaway project, not for anything holding real user data.
  return {
    connectionString,
    ssl: { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' },
  };
}

/** Host and database only. Safe to log, never includes the password. */
export function describeTarget(connectionString = process.env.DATABASE_URL ?? DEFAULT_LOCAL_URL) {
  try {
    const u = new URL(connectionString);
    return `${u.hostname}:${u.port || '5432'}${u.pathname}`;
  } catch {
    return 'unparseable connection string';
  }
}

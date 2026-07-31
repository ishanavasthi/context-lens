import type { ClientConfig } from 'pg';

export declare const DEFAULT_LOCAL_URL: string;

/** Loads the repo root .env so scripts and the API read the same configuration. */
export declare function loadRootEnv(): void;

/** Builds a pg config, enabling TLS for any non local host. */
export declare function connectionConfig(connectionString?: string): ClientConfig;

/** Host and database only. Safe to log, never includes the password. */
export declare function describeTarget(connectionString?: string): string;

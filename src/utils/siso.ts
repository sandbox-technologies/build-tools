import * as fs from 'node:fs';
import * as path from 'node:path';

import * as reclient from './reclient.js';
import type { SanitizedConfig } from '../types.js';

// The REv2 instance name namespaces the remote Action Cache. Release builds
// override this to the release-only namespace (which their RBE token is
// scoped to); everything else uses the shared CI/local namespace.
const SISO_REAPI_INSTANCE =
  process.env['ELECTRON_RBE_INSTANCE'] || 'projects/electron-rbe/instances/default_instance';
const SISO_PROJECT = SISO_REAPI_INSTANCE.split('/')[1] ?? '';

type ConfigLike = Pick<
  SanitizedConfig,
  'remoteBuild' | 'rbeHelperPath' | 'rbeServiceAddress' | 'root'
>;

export function env(config: ConfigLike): Record<string, string> {
  if (config.remoteBuild !== 'siso') return {};

  const base: Record<string, string> = {
    SISO_PROJECT,
    SISO_REAPI_INSTANCE,
    SISO_REAPI_ADDRESS: reclient.serviceAddress(config),
    SISO_CREDENTIAL_HELPER: reclient.helperPath(config),
  };

  return Object.assign(base, reclient.helperFlags(config));
}

function getStarFile(envVar: string, filename: string): string {
  const envVal = process.env[envVar];
  if (envVal && fs.existsSync(envVal)) {
    return envVal;
  }
  return path.resolve(import.meta.dirname, '../../tools', filename);
}

function positiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer; got ${raw}`);
  }
  return value;
}

function booleanEnv(name: string): boolean {
  const value = process.env[name];
  if (!value) return false;
  if (value === '1' || value === 'true') return true;
  if (value === '0' || value === 'false') return false;
  throw new Error(`${name} must be 1, 0, true, or false; got ${value}`);
}

function outputLocalStrategy(): 'full' | 'greedy' | 'minimum' {
  const value = process.env['ELECTRON_RBE_OUTPUT_LOCAL_STRATEGY'] || 'full';
  if (value !== 'full' && value !== 'greedy' && value !== 'minimum') {
    throw new Error(
      `ELECTRON_RBE_OUTPUT_LOCAL_STRATEGY must be full, greedy, or minimum; got ${value}`,
    );
  }
  return value;
}

function durationEnv(name: string): string | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  if (!/^[1-9][0-9]*(?:ms|s|m|h)$/.test(value)) {
    throw new Error(`${name} must be a positive duration such as 60s; got ${value}`);
  }
  return value;
}

export function flags(config: ConfigLike, hasExecute: boolean): (string | number)[] {
  if (config.remoteBuild !== 'siso') return [];

  const result: (string | number)[] = [
    '-remote_jobs',
    positiveIntegerEnv('ELECTRON_RBE_REMOTE_JOBS', 200),
    '-output_local_strategy',
    outputLocalStrategy(),
    '-project',
    SISO_PROJECT,
    '-reapi_instance',
    SISO_REAPI_INSTANCE,
    '-reapi_address',
    reclient.serviceAddress(config),
    '-load',
    getStarFile('ELECTRON_BUILD_TOOLS_MAIN_STAR', 'main.star'),
  ];

  const localJobs = process.env['ELECTRON_RBE_LOCAL_JOBS'];
  if (localJobs) {
    result.push('-local_jobs', positiveIntegerEnv('ELECTRON_RBE_LOCAL_JOBS', 1));
  }

  const fsMinFlushTimeout = durationEnv('ELECTRON_RBE_FS_MIN_FLUSH_TIMEOUT');
  if (fsMinFlushTimeout) {
    result.push('-fs_min_flush_timeout', fsMinFlushTimeout);
  }

  if (booleanEnv('ELECTRON_RBE_CACHE_WRITE')) {
    result.push('-re_cache_enable_write');
  }

  if (booleanEnv('ELECTRON_RBE_FAST_LOCAL')) {
    result.push('-batch=false', '-fast_local');
  }

  // Keep the Execute stream open instead of closing it and polling the
  // longrunning Operations service. Buildbarn (our REAPI backend) does not
  // implement google.longrunning.Operations, so the polling path fails with
  // Unimplemented, the step hits its remote deadline and falls back to a local
  // compile. Measured on the Studio release builds: 74% (Aug 17) and 23%
  // (Sep 18) of remote compiles fell back this way.
  if (booleanEnv('ELECTRON_RBE_KEEP_EXEC_STREAM')) {
    result.push('-reapi_keep_exec_stream');
  }

  // Never run a remote-capable step locally (no fast-local racing, no local
  // fallback). Remote errors are retried (-reapi_max_retries) and then fail the
  // build instead of silently moving compiles onto the local machine.
  if (booleanEnv('ELECTRON_RBE_STRICT_REMOTE')) {
    result.push('-strict_remote');
  }

  const maxRetries = process.env['ELECTRON_RBE_MAX_RETRIES'];
  if (maxRetries) {
    result.push('-reapi_max_retries', positiveIntegerEnv('ELECTRON_RBE_MAX_RETRIES', 10));
  }

  // mTLS to the REAPI frontend. siso also reads $RBE_tls_ca_cert /
  // $RBE_tls_client_auth_cert / $RBE_tls_client_auth_key defaults (provided by
  // the credential helper's flags), so these explicit flags only apply when the
  // caller overrides them.
  const tlsCa = process.env['ELECTRON_RBE_TLS_CA_CERT'];
  const tlsCert = process.env['ELECTRON_RBE_TLS_CLIENT_CERT'];
  const tlsKey = process.env['ELECTRON_RBE_TLS_CLIENT_KEY'];
  if (tlsCa || tlsCert || tlsKey) {
    if (!(tlsCa && tlsCert && tlsKey)) {
      throw new Error(
        'ELECTRON_RBE_TLS_CA_CERT, ELECTRON_RBE_TLS_CLIENT_CERT and ELECTRON_RBE_TLS_CLIENT_KEY must be set together',
      );
    }
    for (const [name, file] of [
      ['ELECTRON_RBE_TLS_CA_CERT', tlsCa],
      ['ELECTRON_RBE_TLS_CLIENT_CERT', tlsCert],
      ['ELECTRON_RBE_TLS_CLIENT_KEY', tlsKey],
    ] as const) {
      if (!fs.existsSync(file)) throw new Error(`${name} points at a missing file: ${file}`);
    }
    result.push(
      '-reapi_insecure=false',
      '-reapi_tls_ca_cert',
      tlsCa,
      '-reapi_tls_client_auth_cert',
      tlsCert,
      '-reapi_tls_client_auth_key',
      tlsKey,
    );
  }

  if (!hasExecute) {
    result.push('-re_exec_enable=false');
  }

  return result;
}

export async function ensureBackendStarlark(config: ConfigLike): Promise<void> {
  if (config.remoteBuild !== 'siso') return;

  const starlarkDir = path.resolve(config.root, 'src/build/config/siso/backend_config');
  if (!fs.existsSync(starlarkDir)) {
    throw new Error(
      `Missing SISO backend config at ${starlarkDir}. Either disable siso in build-tools or ensure you are on a branch that supports it.`,
    );
  }

  const backendConfig = getStarFile('ELECTRON_BUILD_TOOLS_BACKEND_STAR', 'backend.star');
  const starlarkPath = path.resolve(starlarkDir, 'backend.star');
  let needsUpdate = true;
  if (fs.existsSync(starlarkPath)) {
    needsUpdate =
      (await fs.promises.readFile(starlarkPath, 'utf8')) !==
      (await fs.promises.readFile(backendConfig, 'utf8'));
  }

  if (needsUpdate) {
    await fs.promises.mkdir(path.dirname(starlarkPath), { recursive: true });
    await fs.promises.copyFile(backendConfig, starlarkPath);
  }
}

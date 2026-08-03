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
  const value = Number.parseInt(raw, 10);
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

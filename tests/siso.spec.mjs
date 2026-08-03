import { afterEach, describe, expect, it } from 'vitest';

import { flags } from '../dist/utils/siso.js';

const config = {
  remoteBuild: 'siso',
  rbeHelperPath: '/custom/credential-helper',
  rbeServiceAddress: '127.0.0.1:8980',
  root: '/electron',
};

const variables = [
  'ELECTRON_RBE_REMOTE_JOBS',
  'ELECTRON_RBE_LOCAL_JOBS',
  'ELECTRON_RBE_OUTPUT_LOCAL_STRATEGY',
  'ELECTRON_RBE_FS_MIN_FLUSH_TIMEOUT',
  'ELECTRON_RBE_CACHE_WRITE',
  'ELECTRON_RBE_FAST_LOCAL',
];

afterEach(() => {
  for (const variable of variables) delete process.env[variable];
});

describe('Siso tuning', () => {
  it('keeps conservative defaults', () => {
    const result = flags(config, true);
    expect(result).toContain(200);
    expect(result).toContain('full');
    expect(result).not.toContain('-re_cache_enable_write');
    expect(result).not.toContain('-fast_local');
  });

  it('enables trusted cache writes and production concurrency tuning', () => {
    process.env.ELECTRON_RBE_REMOTE_JOBS = '400';
    process.env.ELECTRON_RBE_LOCAL_JOBS = '24';
    process.env.ELECTRON_RBE_OUTPUT_LOCAL_STRATEGY = 'minimum';
    process.env.ELECTRON_RBE_FS_MIN_FLUSH_TIMEOUT = '60s';
    process.env.ELECTRON_RBE_CACHE_WRITE = '1';
    process.env.ELECTRON_RBE_FAST_LOCAL = '1';

    expect(flags(config, true)).toEqual(
      expect.arrayContaining([
        '-remote_jobs',
        400,
        '-local_jobs',
        24,
        '-output_local_strategy',
        'minimum',
        '-fs_min_flush_timeout',
        '60s',
        '-re_cache_enable_write',
        '-batch=false',
        '-fast_local',
      ]),
    );
  });

  it('rejects invalid tuning values', () => {
    process.env.ELECTRON_RBE_REMOTE_JOBS = 'zero';
    expect(() => flags(config, true)).toThrow(/positive integer/);

    process.env.ELECTRON_RBE_REMOTE_JOBS = '2.5';
    expect(() => flags(config, true)).toThrow(/positive integer/);

    delete process.env.ELECTRON_RBE_REMOTE_JOBS;
    process.env.ELECTRON_RBE_FS_MIN_FLUSH_TIMEOUT = 'forever';
    expect(() => flags(config, true)).toThrow(/positive duration/);
  });
});

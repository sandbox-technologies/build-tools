import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as reclient from '../dist/utils/reclient.js';
import * as siso from '../dist/utils/siso.js';

let temporary;
let helper;
let invocationLog;
let config;

describe('custom RBE credential helpers', () => {
  beforeAll(() => {
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'build-tools-rbe-helper-'));
    helper = path.join(temporary, 'credential-helper.sh');
    invocationLog = path.join(temporary, 'invocations.log');
    fs.writeFileSync(helper, `#!/bin/sh
echo "$1" >> ${JSON.stringify(invocationLog)}
case "$1" in
  status) echo "Authentication Status: Authenticated" ;;
  flags) echo '{"RBE_exec_strategy":"remote_local_fallback"}' ;;
  *) exit 2 ;;
esac
`);
    fs.chmodSync(helper, 0o755);
    config = {
      remoteBuild: 'siso',
      rbeHelperPath: helper,
      rbeServiceAddress: '127.0.0.1:8980',
      root: '/electron',
    };
  });

  afterAll(() => {
    fs.rmSync(temporary, { recursive: true, force: true });
  });

  it('uses the configured helper for auth and flags', () => {
    expect(reclient.auth(config)).toBe(true);
    expect(reclient.helperFlags(config)).toEqual({
      RBE_exec_strategy: 'remote_local_fallback',
    });
    expect(fs.readFileSync(invocationLog, 'utf8').trim().split('\n')).toEqual([
      'status',
      'flags',
      'flags',
    ]);
  });

  it('passes the configured helper through the Siso environment', () => {
    expect(siso.env(config)).toMatchObject({
      SISO_REAPI_ADDRESS: '127.0.0.1:8980',
      SISO_CREDENTIAL_HELPER: helper,
      RBE_exec_strategy: 'remote_local_fallback',
    });
    expect(fs.readFileSync(invocationLog, 'utf8').trim().split('\n').at(-1)).toBe('flags');
  });
});

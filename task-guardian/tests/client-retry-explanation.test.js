import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
let registration;
vm.runInNewContext(fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), { window: { __ModuleLoader__: { load: value => { registration = value; } } }, Date, Object, String });
const client = registration.factory(name => { assert.equal(name, 'react'); return { createElement() {} }; });
const zh = key => client.ZH[key] ?? key;
const en = key => client.EN[key] ?? key;

test('terminal handoff refusals explain zero retries in both interface languages', () => {
  for (const reason of ['native-policy-missing', 'native-policy-unsupported', 'native-policy-invalid', 'native-state-unavailable', 'native-budget-remaining', 'native-failure-invalid']) {
    for (const translate of [zh, en]) {
      const text = client.retryDecisionText({ kind: 'not-handled', reason, code: 'PI_AI_ERROR' }, translate);
      assert.ok(text.includes('PI_AI_ERROR'));
      assert.equal(text.includes('retry.native-'), false);
      assert.equal(text.includes('nativeSkip'), false);
    }
  }
  assert.match(client.retryDecisionText({ kind: 'permanent', reason: 'quota', code: 'QUOTA' }, zh), /永久性错误/);
  assert.match(client.retryDecisionText({ kind: 'unknown', reason: 'unrecognized-failure', code: 'PI_AI_ERROR' }, zh), /无法确认/);
  assert.equal(client.retryDecisionText({ kind: 'scheduled', reason: 'server-overloaded' }, zh), null);
});

test('failure that ended before activation is explicitly distinguished from an active guarded retry', () => {
  const failure = { at: 1793082947087, guardEnabledAt: 1793082971590, beforeGuardEnabled: true, code: 'PI_AI_ERROR' };
  const text = client.failureTimingText(failure, zh);
  assert.match(text, /开启守护前已结束/); assert.match(text, /守护开启于/); assert.match(text, /PI_AI_ERROR/);
  const other = client.failureTimingText({ ...failure, beforeGuardEnabled: false }, zh);
  assert.equal(other.includes('开启守护前已结束'), false);
  assert.equal(client.failureTimingText(null, zh), null);
  assert.match(client.ZH.noRetroactive, /不会自动重放/);
  assert.deepEqual(Object.keys(client.ZH).sort(), Object.keys(client.EN).sort());
});

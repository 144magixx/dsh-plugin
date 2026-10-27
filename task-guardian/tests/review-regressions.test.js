import test from 'node:test';
import assert from 'node:assert/strict';
import { createGuardianStore, defaultRecord } from '../lib/store.js';
import { createGuardianService } from '../lib/index.js';
import { createLifecycleState, applyLifecycle, assessRecovery } from '../lib/recovery.js';

test('store close drains an already accepted stop/revocation behind an in-flight durable write', async () => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers(), tables = new Map();
  let first = true;
  const domain = { open: async () => ({ table: name => {
    if (!tables.has(name)) tables.set(name, new Map()); const rows = tables.get(name);
    return { get: key => rows.get(key), entries: () => rows.entries(), put: async (key, value) => { if (name === 'sessions' && first) { first = false; entered.resolve(); await release.promise; } rows.set(key, value); } };
  }, close: async () => {} }) };
  const store = await createGuardianStore(domain);
  const initial = store.update('session-a', 'initial', r => ({ ...r, settings: { ...r.settings, enabled: true } }));
  const stopped = store.update('session-a', 'stop', r => ({ ...r, settings: { ...r.settings, enabled: false }, run: { phase: 'stopped', lastSeq: 8 } }));
  await entered.promise; const closing = store.close();
  await assert.rejects(store.update('session-a', 'too_late', r => r), /closed/);
  release.resolve(); await Promise.all([initial, stopped, closing]);
  const final = [...tables.get('sessions').values()][0];
  assert.equal(final.settings.enabled, false); assert.equal(final.run.phase, 'stopped');
});

test('service releases its process lease even when native storage close fails', async () => {
  let leaseReleased = false;
  const ctx = { on: () => () => {}, logger: { warn() {} }, storageDomain: {}, agents: { get() {} } };
  const service = createGuardianService(ctx, {
    leaseFactory: async () => ({ close: async () => { leaseReleased = true; } }),
    storeFactory: async () => ({ list: () => [], healthy: () => true, get: defaultRecord, close: async () => { throw Error('backend close failed'); } }),
    compatibilityReader: async () => ({ supported: true }),
  });
  await service.ready;
  const closing = service.dispose(); assert.equal(service.dispose(), closing);
  await assert.rejects(closing, /backend close failed/); assert.equal(leaseReleased, true);
});

test('old completed guardian cache cannot hide a newer interrupted native turn', () => {
  let state = createLifecycleState();
  const events = [
    ['turn/start', { turn: 1 }], ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
    ['turn/start', { turn: 2 }], ['step/start', { turn: 2, step: 1 }],
    ['step/end', { turn: 2, step: 1 }], ['turn/end', { turn: 2, reason: { kind: 'interrupted' } }],
  ];
  for (const [seq, [type, data]] of events.entries()) state = applyLifecycle(state, { seq, type, data, time: 1000 + seq });
  const record = { ...defaultRecord('session-a'), settings: { enabled: true, recoverAfterRestart: true, autoSelectFirst: false }, run: { phase: 'completed', lastSeq: 1 } };
  const result = assessRecovery({ record, snapshot: state, workspaceAvailable: true });
  assert.equal(result.status, 'need_confirmation'); assert.equal(result.reasonCode, 'turn_not_completed');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { acquireLease, createAlertStore, defaultRecord, sessionKey } from '../lib/store.js';

const allowedKeys = ['version', 'sessionId', 'revision', 'updatedAt', 'notificationSeq', 'notificationProjectionVersion', 'notification', 'audit'];
const notice = (id = 'a:end:10', acknowledged = false) => ({ id, sessionId: 'a', at: 100, updatedAt: 100, visibleAt: 100, kind: 'error', state: 'failed', code: 'SERVER', message: 'Synthetic failure', acknowledged });
function legacyRecord({ acknowledged = true } = {}) {
  return { version: 1, sessionId: 'a', revision: 7, updatedAt: 100, epoch: 3,
    settings: { enabled: true, recoverAfterRestart: true, autoSelectFirst: true },
    guardEnabledAt: 10, run: { phase: 'running' }, retry: { attempt: 2, retryAt: 9999 },
    recovery: { status: 'need_confirmation' }, lifecycle: { toolCalls: [{ arguments: 'old tool arguments' }] },
    lastDecision: { kind: 'scheduled' }, notificationSeq: 10, notificationProjectionVersion: 2,
    notification: notice('a:end:10', acknowledged), audit: [{ id: 'old-audit', kind: 'notification_observed', revision: 7 }] };
}
function memoryDomain({ records = [], config = [], failAudit = false, failSessions = false, beforePut } = {}) {
  const data = new Map([
    ['sessions', new Map(records.map(record => [sessionKey(record.sessionId), structuredClone(record)]))],
    ['audit', new Map()], ['config', new Map(config.map(([key, value]) => [key, structuredClone(value)]))],
  ]);
  const specs = [], closures = [];
  return { data, specs, closures, open: async spec => {
    specs.push(spec);
    for (const [name, definition] of Object.entries(spec.tables)) for (const value of data.get(name).values()) definition.valueSchema.parse(value);
    return { table: name => {
      const rows = data.get(name), valueSchema = spec.tables[name].valueSchema;
      return { get: key => rows.get(key), entries: () => rows.entries(), put: async (key, value) => {
        if (name === 'audit' && failAudit) throw Error('audit disk failed');
        if (name === 'sessions' && failSessions) throw Error('session disk failed');
        await beforePut?.(name, key, value);
        rows.set(key, valueSchema.parse(value));
      } };
    }, close: async () => { closures.push(true); } };
  } };
}

test('alerts store defaults contain no task authority and preserve the legacy domain/table layout', async () => {
  const record = defaultRecord('new', 123);
  assert.deepEqual(record, { version: 1, sessionId: 'new', revision: 0, updatedAt: 123, audit: [] });
  const domain = memoryDomain();
  const store = await createAlertStore(domain, { now: () => 123 });
  assert.equal(domain.specs[0].name, 'task_guardian'); assert.equal(domain.specs[0].version, 1);
  assert.equal(domain.specs[0].layout, 'per-record');
  assert.deepEqual(Object.keys(domain.specs[0].tables).sort(), ['audit', 'config', 'sessions']);
  assert.equal(store.getStartup, undefined); assert.equal(store.setStartup, undefined);
  assert.deepEqual(store.get('new'), record);
  await store.close();
});

test('eager v1 migration preserves exact notice identity, acknowledgement, projection cursor and prior audit while removing authority', async () => {
  const legacy = legacyRecord();
  const oldStartup = { enabled: true, appPath: '/synthetic/application', at: 42 };
  const domain = memoryDomain({ records: [legacy], config: [['startup', oldStartup]] });
  const store = await createAlertStore(domain, { ownerId: 'test-owner', now: () => 200 });
  const migrated = domain.data.get('sessions').get(sessionKey('a'));
  assert.ok(Object.keys(migrated).every(key => allowedKeys.includes(key)));
  assert.equal(migrated.revision, 8); assert.equal(migrated.updatedAt, 200);
  assert.deepEqual(migrated.notification, legacy.notification);
  assert.equal(migrated.notificationSeq, 10); assert.equal(migrated.notificationProjectionVersion, 2);
  assert.deepEqual(migrated.audit[0], legacy.audit[0]);
  assert.equal(migrated.audit.at(-1).kind, 'alerts_only_migrated');
  assert.deepEqual(domain.data.get('config').get('startup'), oldStartup, 'migration is not a system-startup mutation');
  const exposed = store.get('a'); exposed.notification.acknowledged = false;
  assert.equal(store.get('a').notification.acknowledged, true, 'returned records are detached');
  const listed = store.list(); listed[0].notification.id = 'mutated';
  assert.equal(store.get('a').notification.id, 'a:end:10');
  await store.close();
  const reopened = await createAlertStore(domain, { now: () => 300 });
  assert.equal(reopened.get('a').revision, 8, 'already migrated records do not repeat migration on every restart');
  assert.deepEqual(reopened.get('a').notification, legacy.notification);
  await reopened.close();
});

test('writes only retain notification fields even if an old caller supplies guard settings again', async () => {
  const domain = memoryDomain();
  const store = await createAlertStore(domain, { now: () => 500 });
  await store.update('a', 'notification_observed', current => ({ ...current, notification: notice(), notificationSeq: 10,
    settings: { enabled: true }, epoch: 99, run: { phase: 'running' }, retry: { retryAt: 999 }, recovery: { status: 'restore' }, lifecycle: { toolCalls: ['private'] } }));
  const saved = domain.data.get('sessions').get(sessionKey('a'));
  assert.ok(Object.keys(saved).every(key => allowedKeys.includes(key)));
  assert.equal(saved.notification.id, 'a:end:10');
  const audit = [...domain.data.get('audit').values()][0];
  assert.equal(audit.notification.id, 'a:end:10');
  for (const key of ['settings', 'epoch', 'run', 'retry', 'recovery', 'lifecycle']) assert.equal(Object.hasOwn(audit, key), false);
  const revision = saved.revision;
  await store.update('a', 'no_change', () => undefined);
  assert.equal(store.get('a').revision, revision);
  await store.close();
});

test('close drains accepted notification and acknowledgement writes, while later writes are rejected', async () => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  let first = true;
  const domain = memoryDomain({ beforePut: async name => { if (name === 'sessions' && first) { first = false; entered.resolve(); await release.promise; } } });
  const store = await createAlertStore(domain);
  const published = store.update('a', 'notification_observed', current => ({ ...current, notification: notice() }));
  const acknowledged = store.update('a', 'notification_acknowledged', current => ({ ...current, notification: { ...current.notification, acknowledged: true } }));
  await entered.promise;
  const closing = store.close();
  await assert.rejects(store.update('a', 'late', current => current), /closed/);
  release.resolve(); await Promise.all([published, acknowledged, closing]);
  const saved = domain.data.get('sessions').get(sessionKey('a'));
  assert.equal(saved.revision, 2); assert.equal(saved.notification.acknowledged, true);
  assert.equal(domain.closures.length, 1);
});

test('audit failure retains the primary acknowledgement and marks the store unavailable', async () => {
  const domain = memoryDomain({ failAudit: true });
  const store = await createAlertStore(domain);
  await assert.rejects(store.update('a', 'notification_acknowledged', current => ({ ...current, notification: notice('a:end:10', true) })), /audit disk failed/);
  assert.equal(store.get('a').notification.acknowledged, true);
  assert.equal(store.healthy(), false);
  await assert.rejects(store.update('a', 'later', current => current), /audit disk failed/);
  await store.close();
});

test('failed legacy migration closes its domain and never presents a partially initialized store', async () => {
  const domain = memoryDomain({ records: [legacyRecord()], failSessions: true });
  await assert.rejects(createAlertStore(domain), /session disk failed/);
  assert.equal(domain.closures.length, 1);
  assert.equal(domain.data.get('sessions').get(sessionKey('a')).revision, 7);
});

test('invalid native stored notification records fail validation before migration', async () => {
  const legacy = legacyRecord(); legacy.notification.acknowledged = 'yes';
  await assert.rejects(createAlertStore(memoryDomain({ records: [legacy] })), /invalid persisted data/);
});

test('OS lease still excludes concurrent acknowledgement writers and releases cleanly', async () => {
  const identity = path.join(os.tmpdir(), 'task-alerts-' + randomUUID());
  const first = await acquireLease({ identity });
  try { await assert.rejects(acquireLease({ identity }), /lease unavailable/); }
  finally { await first.close(); }
  const next = await acquireLease({ identity });
  await next.close();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createAlertsService, createFetchHandler, readInput } from '../lib/index.js';
import * as plugin from '../lib/index.js';
import { defaultRecord } from '../lib/store.js';
import { ALERT_PROJECTION } from '../lib/alerts.js';

function emptyContext() {
  const forbidden = [];
  const deny = operation => () => { forbidden.push(operation); throw Error(`unexpected ${operation}`); };
  return { forbidden, logger: { warn() {} }, storageDomain: {},
    agents: { list: () => [], get: () => undefined, create: deny('agent.create'), resume: deny('agent.resume') },
    goals: { resume: deny('goal.resume') }, userQuestions: { answer: deny('question.answer') },
    sessionQuery: { observeSession: deny('unexpected session observation') },
  };
}
function memoryStore(records = []) {
  const rows = new Map(records.map(record => [record.sessionId, structuredClone(record)]));
  let closed = 0;
  return { rows, get closed() { return closed; }, list: () => [...rows.values()].map(value => structuredClone(value)),
    healthy: () => closed === 0, get: id => structuredClone(rows.get(id) || defaultRecord(id, 100)),
    async update(id, _kind, change) {
      const current = this.get(id), next = await change(current);
      if (next) rows.set(id, { ...next, revision: current.revision + 1 });
      return this.get(id);
    }, async close() { closed++; },
  };
}

const response = async (service, action, body) => {
  const value = await createFetchHandler(service, action)(new Request('http://offline.invalid/api/task-guardian/' + action, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
  return { status: value.status, body: await value.json() };
};

test('service exposes only observation and acknowledgement, with no old guardian authority methods', async () => {
  const ctx = emptyContext(), store = memoryStore();
  let releases = 0;
  const service = createAlertsService(ctx, { leaseFactory: async () => ({ close: async () => { releases++; } }), storeFactory: async () => store, now: () => 100 });
  await service.ready;
  assert.deepEqual(Object.keys(service).sort(), ['acknowledge', 'acknowledgeAll', 'alerts', 'dispose', 'fail', 'onProjection', 'ready']);
  assert.equal(plugin.createGuardianService, undefined); assert.equal(plugin.detectCompatibility, undefined);
  const result = await service.alerts();
  assert.equal(result.mode, 'alerts-only'); assert.equal(Object.hasOwn(result, 'compatibility'), false);
  assert.deepEqual(result.alerts, []);
  assert.deepEqual(ctx.forbidden, []);
  await service.dispose(); assert.equal(store.closed, 1); assert.equal(releases, 1);
});

test('dispose before lease acquisition completes releases the lease without opening storage or agents', async () => {
  const gate = Promise.withResolvers(), ctx = emptyContext();
  let releases = 0, opens = 0;
  const service = createAlertsService(ctx, { leaseFactory: () => gate.promise, storeFactory: async () => { opens++; return memoryStore(); } });
  const closing = service.dispose();
  assert.equal(service.dispose(), closing);
  gate.resolve({ close: async () => { releases++; } });
  await closing;
  assert.equal(releases, 1); assert.equal(opens, 0); assert.deepEqual(ctx.forbidden, []);
});

test('store initialization failure produces an explicit notification fault and still releases the lease', async () => {
  const ctx = emptyContext(); let releases = 0;
  const service = createAlertsService(ctx, { leaseFactory: async () => ({ close: async () => { releases++; } }),
    storeFactory: async () => { throw Object.assign(Error('disk unavailable'), { code: 'disk_unavailable' }); } });
  await service.ready;
  const value = await service.alerts();
  assert.equal(value.fault, 'disk_unavailable'); assert.equal(value.mode, 'alerts-only');
  await assert.rejects(service.acknowledge({ sessionId: 'a', alertId: 'a:end:1' }), error => error.status === 503);
  await service.dispose(); assert.equal(releases, 1); assert.deepEqual(ctx.forbidden, []);
});

test('store close failure cannot leak the process acknowledgement-writer lease', async () => {
  const ctx = emptyContext(), store = memoryStore(); let releases = 0;
  store.close = async () => { throw Error('close failed'); };
  const service = createAlertsService(ctx, { leaseFactory: async () => ({ close: async () => { releases++; } }), storeFactory: async () => store });
  await service.ready;
  await assert.rejects(service.dispose(), /close failed/);
  assert.equal(releases, 1); assert.deepEqual(ctx.forbidden, []);
});

test('legacy guardian retry becomes a clear interruption even if that Agent still exists, without launching or answering anything', async () => {
  const notification = { id: 'a:retry:3', sessionId: 'a', turn: 1, origin: 'guardian', kind: 'retrying', state: 'retrying',
    code: 'SERVER', message: 'old automatic retry', at: 100, updatedAt: 100, visibleAt: 200, nextRetryAt: 9999, acknowledged: true };
  const store = memoryStore([{ ...defaultRecord('a', 100), notification, notificationSeq: 3, notificationProjectionVersion: 2 }]);
  const ctx = emptyContext(); let observationsClosed = 0;
  ctx.agents.list = () => [{ id: 'a', status: 'running' }];
  ctx.agents.get = () => ({ id: 'a', status: 'running' });
  ctx.sessionQuery.observeSession = async () => ({ projections: { values: { [ALERT_PROJECTION]: { sessionId: 'a', seq: 3, incident: null } } },
    [Symbol.dispose]() { observationsClosed++; },
  });
  const service = createAlertsService(ctx, { leaseFactory: async () => ({ close: async () => {} }), storeFactory: async () => store, now: () => 500 });
  await service.ready;
  const result = await service.alerts();
  assert.equal(result.total, 1); assert.equal(result.alerts[0].state, 'failed');
  assert.equal(result.alerts[0].kind, 'interrupted'); assert.equal(result.alerts[0].code, 'RETRY_INTERRUPTED');
  assert.equal(result.alerts[0].nextRetryAt, null); assert.equal(result.alerts[0].acknowledged, false);
  assert.notEqual(result.alerts[0].id, notification.id);
  assert.equal(observationsClosed, 1); assert.deepEqual(ctx.forbidden, []);
  await service.dispose();
});

test('HTTP handlers reject removed guardian actions, authority parameters and oversized request bodies', async () => {
  const ctx = emptyContext(), store = memoryStore();
  const service = createAlertsService(ctx, { leaseFactory: async () => ({ close: async () => {} }), storeFactory: async () => store });
  await service.ready;
  for (const action of ['snapshot', 'configure', 'startup']) {
    const value = await response(service, action, { sessionId: 'a' });
    assert.equal(value.status, 400); assert.equal(value.body.error, 'invalid_request');
  }
  const input = await response(service, 'alerts', { enabled: true });
  assert.equal(input.status, 400); assert.equal(input.body.error, 'invalid_request');
  await assert.rejects(readInput(new Request('http://offline.invalid/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(9000) })), error => error.status === 413);
  await assert.rejects(readInput(new Request('http://offline.invalid/', { method: 'GET' })), error => error.status === 405);
  await service.dispose();
});

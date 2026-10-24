import test from 'node:test';
import assert from 'node:assert/strict';
import { SideBranchService } from '../lib/service.js';
import { NOTE_SOURCE } from '../lib/history.js';

function prepared() {
  const record = { state: 'ready', sessionId: 'branch', sourceSessionId: 'main', mode: 'edit', turn: 2, drift: { files: ['a.py'], laterTurns: 3, unknown: true } };
  const events = [{ seq: 0, type: 'user/message', surfaceOp: 'append', data: { source: { kind: NOTE_SOURCE } } }];
  const session = { inheritedEventCount: 1, snapshotEvents: n => events.slice(n) };
  const agent = { id: 'branch', session };
  const table = { entries: () => [['req', record]], get: () => record };
  return { service: new SideBranchService({}, table), agent, events, record };
}
const prompt = { id: 'corrected', source: { kind: 'user' }, role: 'user', content: [{ type: 'text', text: 'corrected' }] };
test('first admitted prompt gets one note; inherited ancestors notes do not suppress it', async () => {
  const f = prepared(); const decision = { kind: 'enter', messages: [prompt], startsRequestSeries: true };
  const result = await f.service.guard({ agent: f.agent }, () => decision);
  assert.equal(result.messages.length, 2); assert.equal(result.messages[0].source.kind, NOTE_SOURCE);
  assert.equal(result.messages[1], prompt); assert.equal(result.startsRequestSeries, true);
  assert.equal(decision.messages.length, 1);
});
test('aborted admission remains retryable; committed note suppresses duplicates across restart', async () => {
  const f = prepared(); const controller = new AbortController(); controller.abort();
  const decision = { kind: 'enter', messages: [prompt] };
  assert.equal(await f.service.guard({ agent: f.agent, signal: controller.signal }, () => decision), decision);
  const accepted = await f.service.guard({ agent: f.agent }, () => decision);
  assert.equal(accepted.messages.length, 2);
  f.events.push({ seq: 1, type: 'user/message', surfaceOp: 'append', data: accepted.messages[0] });
  assert.equal(await f.service.guard({ agent: f.agent }, () => decision), decision);
  const restored = new SideBranchService({}, { entries: () => [['req', f.record]], get: () => f.record });
  assert.equal(await restored.guard({ agent: f.agent }, () => decision), decision);
});
test('no input, rejected decisions and other sessions are untouched', async () => {
  const f = prepared();
  for (const decision of [{ kind: 'reject' }, { kind: 'enter', messages: [] }]) assert.equal(await f.service.guard({ agent: f.agent }, () => decision), decision);
  const decision = { kind: 'enter', messages: [prompt] };
  assert.equal(await f.service.guard({ agent: { id: 'unrelated' } }, () => decision), decision);
});

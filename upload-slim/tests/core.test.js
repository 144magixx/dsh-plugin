import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BASELINE, DSH_DEFAULT, STRATEGIES, driftedRoutes, imagesFromEvents, normalizeState, noticeText, planChanges,
  requestImageDimensions, requestTarget, strategyFields, targetRoutes,
} from '../lib/core.js';

const SHA = 'sha256:' + 'a'.repeat(64);

test('request dimensions match DSH semantics: inward, aspect-preserving, no enlargement', () => {
  assert.deepEqual(requestImageDimensions(1280, 720, 1600 * 900), { width: 1280, height: 720 });
  assert.deepEqual(requestImageDimensions(2048, 1152, 1280 * 720), { width: 1280, height: 720 });
  for (const [w, hh, px] of [[1560, 1200, 921600], [600, 4000, 518400], [3000, 3000, 1440000], [1, 5000, 100]]) {
    const out = requestImageDimensions(w, hh, px);
    assert.ok(out.width * out.height <= px, `${w}x${hh}`);
    assert.ok(out.width <= w && out.height <= hh);
    assert.ok(Math.abs(out.width / out.height - w / hh) / (w / hh) < 0.05 || out.width === 1 || out.height === 1);
  }
  assert.deepEqual(requestTarget({ width: 2048, height: 1152 }, strategyFields('saver')), { width: 1280, height: 720, maxBytes: 120 * 1024 });
});

test('strategies shrink monotonically and the baseline equals DSH defaults', () => {
  assert.deepEqual(strategyFields(BASELINE), DSH_DEFAULT);
  for (let i = 1; i < STRATEGIES.length; i++) {
    assert.ok(STRATEGIES[i].pixels < STRATEGIES[i - 1].pixels);
    assert.ok(STRATEGIES[i].maxBytes < STRATEGIES[i - 1].maxBytes);
  }
  assert.throws(() => strategyFields('nope'), { code: 'unknown_strategy' });
});

test('normalizeState drops junk and keeps only complete originals', () => {
  const state = normalizeState({ enabled: 'yes', strategy: 'x', routes: ['b', 'a', 'a', 3], uplinkKBps: -1, originals: {
    ok: { requestImagePixelBudget: { present: true, value: 5 }, requestImageMaxBytes: { present: false } },
    partial: { requestImagePixelBudget: { present: false } },
  } });
  assert.equal(state.enabled, false);
  assert.equal(state.strategy, 'balanced');
  assert.deepEqual(state.routes, ['a', 'b']);
  assert.equal(state.uplinkKBps, 80);
  assert.deepEqual(Object.keys(state.originals), ['ok']);
});

test('enable records originals and sets both fields on every target route', () => {
  const state = normalizeState({ enabled: true, strategy: 'saver' });
  const plan = planChanges(state, { available: ['a', 'b'], userProviders: { a: { requestImageMaxBytes: 9 }, b: {} } });
  assert.deepEqual(plan.desired, ['a', 'b']);
  assert.deepEqual(plan.originals.a, { requestImagePixelBudget: { present: false }, requestImageMaxBytes: { present: true, value: 9 } });
  assert.equal(plan.ops.length, 4);
  assert.ok(plan.ops.every(op => op.op === 'set'));
  assert.deepEqual(plan.ops[0], { op: 'set', path: ['providers', 'a', 'requestImagePixelBudget'], value: 1280 * 720 });
});

test('changing strategy keeps the first recorded originals', () => {
  const first = planChanges(normalizeState({ enabled: true, strategy: 'saver' }), { available: ['a'], userProviders: { a: { requestImagePixelBudget: 7 } } });
  const applied = { a: { requestImagePixelBudget: 1280 * 720, requestImageMaxBytes: 120 * 1024 } };
  const second = planChanges(normalizeState({ enabled: true, strategy: 'fidelity', originals: first.originals }), { available: ['a'], userProviders: applied });
  assert.deepEqual(second.originals.a.requestImagePixelBudget, { present: true, value: 7 });
  assert.equal(second.ops.length, 2);
});

test('disable restores set values and unsets fields that were absent', () => {
  const originals = { a: { requestImagePixelBudget: { present: true, value: 7 }, requestImageMaxBytes: { present: false } } };
  const plan = planChanges(normalizeState({ enabled: false, originals }), { available: ['a'], userProviders: { a: { requestImagePixelBudget: 1, requestImageMaxBytes: 2 } } });
  assert.deepEqual(plan.ops, [
    { op: 'set', path: ['providers', 'a', 'requestImagePixelBudget'], value: 7 },
    { op: 'unset', path: ['providers', 'a', 'requestImageMaxBytes'] },
  ]);
  assert.deepEqual(plan.originals, {});
  assert.deepEqual(plan.restored, ['a']);
});

test('deselecting a route restores only that route; vanished routes are forgotten', () => {
  const originals = {
    a: { requestImagePixelBudget: { present: false }, requestImageMaxBytes: { present: false } },
    gone: { requestImagePixelBudget: { present: false }, requestImageMaxBytes: { present: false } },
  };
  const fields = strategyFields('balanced');
  const plan = planChanges(normalizeState({ enabled: true, routes: ['b'], originals }), { available: ['a', 'b'], userProviders: { a: { ...fields }, b: {} } });
  assert.deepEqual(plan.ops.filter(op => op.path[1] === 'a').map(op => op.op), ['unset', 'unset']);
  assert.ok(!plan.ops.some(op => op.path[1] === 'gone'));
  assert.deepEqual(Object.keys(plan.originals), ['b']);
});

test('drift and targets', () => {
  const state = normalizeState({ enabled: true, strategy: 'balanced', routes: ['a', 'missing'] });
  assert.deepEqual(targetRoutes(state, ['a', 'b']), ['a']);
  assert.deepEqual(driftedRoutes(state, { available: ['a'], effectiveProviders: { a: { requestImagePixelBudget: 1, requestImageMaxBytes: 2 } } }), ['a']);
  assert.deepEqual(driftedRoutes(state, { available: ['a'], effectiveProviders: { a: strategyFields('balanced') } }), []);
});

test('notice text is stable per strategy and names the limits', () => {
  const text = noticeText('balanced');
  assert.equal(text, noticeText('balanced'));
  assert.match(text, /1,440,000 pixels/);
  assert.match(text, /200 KB/);
  assert.match(text, /Normalized copy/);
  assert.equal(noticeText('bogus'), '');
});

test('images are read from user messages and tool results, newest first', () => {
  const ref = n => ({ attachmentId: `sha256:${String(n).repeat(64)}`, width: 10, height: 10, mediaType: 'image/png', bytes: 5 });
  const events = [
    { seq: 1, type: 'user/message', data: { content: [{ type: 'text', text: 'x' }, { type: 'image', attachment: ref(1) }] } },
    { seq: 2, type: 'tool/result', data: { message: { content: [{ type: 'image', attachment: ref(2) }, { type: 'image', attachment: { attachmentId: 'bad' } }] } } },
    { seq: 3, type: 'assistant/message', data: { content: [{ type: 'image', attachment: ref(3) }] } },
  ];
  assert.deepEqual(imagesFromEvents(events).map(item => item.seq), [2, 1]);
  assert.equal(SHA.length, 71);
});

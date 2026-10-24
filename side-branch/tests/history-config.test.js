import test from 'node:test';
import assert from 'node:assert/strict';
import { currentConfig } from '../lib/history.js';

const selection = (provider, model, reasoningEffort) => ({ provider, model, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) });
const picked = config => ({ type: 'model/selection', data: config });
const used = (config, adapterDefaults) => ({ type: 'request/header', data: { header: { config, ...(adapterDefaults ? { adapterDefaults } : {}) } } });

test('adapter-default reasoning effort stays implicit even when wire next repeats last use', () => {
  const config = selection('p', 'm', 'high');
  const events = [used(config, { reasoningEffort: true })];
  const before = structuredClone(events);
  const actual = currentConfig(events, { modelSelection: { next: config, lastUsed: config } });
  assert.deepEqual(actual.model, selection('p', 'm'));
  assert.deepEqual(events, before);
});

test('used explicit reasoning effort is preserved unless its exact default flag is true', () => {
  for (const defaults of [undefined, {}, { reasoningEffort: false }, { maxTokens: true }]) {
    assert.deepEqual(currentConfig([used(selection('p', 'm', 'low'), defaults)]).model, selection('p', 'm', 'low'));
  }
});

test('a new unconsumed explicit selection overrides header defaults and stale wire values', () => {
  const events = [used(selection('p', 'old', 'low'), { reasoningEffort: true }), picked(selection('p', 'new', 'high'))];
  assert.deepEqual(currentConfig(events, { modelSelection: { next: selection('other', 'stale') } }).model, selection('p', 'new', 'high'));
});

test('matching request consumes a selection before applying native header default semantics', () => {
  const config = selection('p', 'm', 'high');
  assert.deepEqual(currentConfig([picked(config), used(config, { reasoningEffort: true })]).model, selection('p', 'm'));
  assert.deepEqual(currentConfig([picked(config), used(config)]).model, config);
});

test('a request for another model does not consume the pending explicit selection', () => {
  assert.deepEqual(currentConfig([picked(selection('p', 'next', 'high')), used(selection('p', 'other', 'low'))]).model, selection('p', 'next', 'high'));
});

test('a pending selection without an explicit effort remains implicit after resolved default use', () => {
  assert.deepEqual(currentConfig([picked(selection('p', 'm')), used(selection('p', 'm', 'high'), { reasoningEffort: true })]).model, selection('p', 'm'));
});

test('latest native request header wins over stale wire projection when nothing is pending', () => {
  const events = [used(selection('p', 'old')), used(selection('p', 'current', 'medium'))];
  assert.deepEqual(currentConfig(events, { modelSelection: { next: selection('p', 'stale') } }).model, selection('p', 'current', 'medium'));
});

test('wire model selections are fallback only without native header or explicit intent', () => {
  const fallback = { model: selection('fallback', 'default') };
  assert.deepEqual(currentConfig([], { modelSelection: { next: selection('wire', 'next') } }, fallback).model, selection('wire', 'next'));
  assert.deepEqual(currentConfig([], { modelSelection: { next: null, lastUsed: selection('wire', 'last') } }, fallback).model, selection('wire', 'last'));
  assert.deepEqual(currentConfig([], {}, fallback).model, fallback.model);
  assert.deepEqual(currentConfig([picked(selection('native', 'pending'))], { modelSelection: { next: selection('wire', 'next') } }, fallback).model, selection('native', 'pending'));
});

test('custom effective permissions retain source recorded identity independently', () => {
  const events = [
    used(selection('p', 'm')),
    { type: 'permission/preset', data: { preset: 'auto' } },
    { type: 'permission/preset', data: { preset: 'danger-full-access' } },
    { type: 'sandbox/mode', data: { mode: 'danger-full-access' } },
    { type: 'approval/policy', data: { policy: 'ask' } },
  ];
  const actual = currentConfig(events, { permissions: { currentValue: 'custom' } });
  assert.equal(actual.permissionPreset, 'custom');
  assert.equal(actual.recordedPermissionPreset, 'danger-full-access');
  assert.equal(actual.sandbox, 'danger-full-access');
  assert.equal(actual.approval, 'ask');
});

test('absent recorded preset is explicit null rather than synthesized from derived projection', () => {
  const actual = currentConfig([used(selection('p', 'm'))], { permissions: { currentValue: 'workspace-write' } });
  assert.equal(actual.permissionPreset, 'workspace-write');
  assert.equal(actual.recordedPermissionPreset, null);
});

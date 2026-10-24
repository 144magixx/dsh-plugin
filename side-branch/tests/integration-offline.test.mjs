import test from 'node:test';
import assert from 'node:assert/strict';
import '../scripts/offline-test-guard.mjs';
import net from 'node:net';
import https from 'node:https';
import { spawn } from 'node:child_process';

test('isolated worker refuses sockets, model HTTP requests and subprocesses', () => {
  const server = net.createServer();
  assert.throws(() => server.listen(0), /Offline integration guard forbids server.listen/);
  assert.throws(() => net.connect({ host: '127.0.0.1', port: 1867 }), /Offline integration guard forbids/);
  assert.throws(() => https.request('https://model-api.invalid'), /Offline integration guard forbids/);
  assert.throws(() => fetch('https://model-api.invalid'), /Offline integration guard forbids/);
  assert.throws(() => spawn('forbidden-test-process'), /Offline integration guard forbids/);
});

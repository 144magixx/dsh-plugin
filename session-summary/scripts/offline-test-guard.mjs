import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
import http from 'node:http';
import https from 'node:https';
import http2 from 'node:http2';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

// This guard is process-local to test workers. It never contacts or changes the
// Desktop process and fails immediately if a test tries to bind/connect/spawn.
export const offlineGuard = { denied: [] };
const deny = operation => function () {
  offlineGuard.denied.push(operation);
  throw new Error(`Offline integration guard forbids ${operation}`);
};
net.Server.prototype.listen = deny('server.listen');
net.Socket.prototype.connect = deny('socket.connect');
net.connect = net.createConnection = deny('net.connect');
tls.connect = deny('tls.connect');
dgram.createSocket = deny('dgram.createSocket');
http.request = http.get = deny('http.request');
https.request = https.get = deny('https.request');
http2.connect = deny('http2.connect');
for (const method of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[method] = deny(`child_process.${method}`);
globalThis.fetch = deny('fetch');
globalThis.WebSocket = class { constructor() { deny('WebSocket')(); } };
syncBuiltinESMExports();

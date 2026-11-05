import { createHash, randomUUID } from 'node:crypto';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export const schema = check => ({
  parse(value) { if (!check(value)) throw new Error('Task alerts: invalid persisted data.'); return structuredClone(value); },
  safeParse(value) { try { return { success: true, data: this.parse(value) }; } catch (error) { return { success: false, error }; } },
});
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const recordSchema = schema(value => object(value) && value.version === 1 && typeof value.sessionId === 'string'
  && Number.isSafeInteger(value.revision) && value.revision >= 0 && Array.isArray(value.audit)
  && (value.notification == null || object(value.notification) && typeof value.notification.id === 'string'
    && typeof value.notification.sessionId === 'string' && typeof value.notification.acknowledged === 'boolean'));
export const jsonObjectSchema = schema(object);
export function defaultRecord(sessionId, now = Date.now()) {
  return { version: 1, sessionId, revision: 0, updatedAt: now, audit: [] };
}
export function sessionKey(id) { return createHash('sha256').update(id).digest('hex'); }
/** Keep existing reminder identities/acknowledgements; old guard authority is not carried forward. */
function alertRecord(value) {
  const next = { version: 1, sessionId: value.sessionId, revision: value.revision, updatedAt: value.updatedAt, audit: value.audit };
  for (const key of ['notificationSeq', 'notificationProjectionVersion', 'notification']) if (Object.hasOwn(value, key)) next[key] = value[key];
  return structuredClone(next);
}

/** A process lease prevents two Hosts from overwriting acknowledgements in the shared store. */
export async function acquireLease({ identity = process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), onLost = () => {} } = {}) {
  const hash = createHash('sha256').update(path.resolve(identity)).digest().readUInt32BE(0);
  const port = 42000 + hash % 20000;
  const server = net.createServer(socket => socket.destroy());
  await new Promise((resolve, reject) => {
    const fail = error => { server.close(); reject(new Error(`Task alerts lease unavailable (${error.code || 'bind_failed'}).`)); };
    server.once('error', fail);
    server.listen({ port, host: '127.0.0.1', exclusive: true }, () => { server.removeListener('error', fail); resolve(); });
  });
  let closed = false;
  server.on('error', error => { if (!closed) onLost(error); });
  server.unref();
  return { port, close: () => new Promise(resolve => { if (closed) return resolve(); closed = true; server.close(() => resolve()); }) };
}

export async function createAlertStore(storageDomain, { ownerId = randomUUID(), now = Date.now } = {}) {
  // Retain the domain and legacy tables to migrate existing reminders without replacing storage.
  const domain = await storageDomain.open({ name: 'task_guardian', version: 1, layout: 'per-record', tables: { sessions: { valueSchema: recordSchema }, audit: { valueSchema: jsonObjectSchema }, config: { valueSchema: jsonObjectSchema } } });
  const sessions = domain.table('sessions'), history = domain.table('audit');
  let chain = Promise.resolve(), closed = false, failure;
  const get = id => alertRecord(sessions.get(sessionKey(id)) || defaultRecord(id, now()));
  const update = (id, kind, change) => {
    if (closed || failure) return Promise.reject(failure || new Error('Task alerts store is closed.'));
    const operation = chain.then(async () => {
      if (failure) throw failure;
      const current = get(id);
      const changed = await change(structuredClone(current));
      if (changed === undefined) return current;
      const at = now(), revision = current.revision + 1;
      const entry = { id: randomUUID(), sessionId: id, revision, at, kind, ownerId };
      const next = recordSchema.parse(alertRecord({ ...changed, version: 1, sessionId: id, revision, updatedAt: at, audit: [...current.audit, entry].slice(-64) }));
      try {
        await sessions.put(sessionKey(id), next);
        await history.put(entry.id, { ...entry, notification: next.notification ?? null });
      } catch (error) { failure = error; throw error; }
      return structuredClone(next);
    });
    chain = operation.catch(() => {});
    return operation;
  };
  try {
    for (const [, record] of [...sessions.entries()]) {
      if (['settings', 'epoch', 'run', 'retry', 'recovery', 'lifecycle', 'lastDecision', 'guardEnabledAt'].some(key => Object.hasOwn(record, key))) {
        await update(record.sessionId, 'alerts_only_migrated', current => current);
      }
    }
  } catch (error) { await domain.close(); throw error; }
  return {
    ownerId, get, update,
    list: () => [...sessions.entries()].map(([, value]) => alertRecord(value)),
    healthy: () => !closed && !failure,
    async close() { closed = true; await chain; await domain.close(); },
  };
}

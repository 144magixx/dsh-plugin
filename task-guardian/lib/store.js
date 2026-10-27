import { createHash, randomUUID } from 'node:crypto';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_SETTINGS = Object.freeze({ enabled: true, recoverAfterRestart: true, autoSelectFirst: true });
export const schema = check => ({
  parse(value) { if (!check(value)) throw new Error('Task Guardian: invalid persisted data; manual inspection required.'); return structuredClone(value); },
  safeParse(value) { try { return { success: true, data: this.parse(value) }; } catch (error) { return { success: false, error }; } },
});
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const recordSchema = schema(value => object(value) && value.version === 1 && typeof value.sessionId === 'string' && Number.isSafeInteger(value.revision) && value.revision >= 0 && Number.isSafeInteger(value.epoch) && value.epoch >= 0 && object(value.settings) && Object.keys(DEFAULT_SETTINGS).every(key => typeof value.settings[key] === 'boolean') && object(value.run) && object(value.retry) && object(value.recovery) && Array.isArray(value.audit));
export const jsonObjectSchema = schema(object);
export function defaultRecord(sessionId, now = Date.now()) {
  return { version: 1, sessionId, revision: 0, epoch: 0, settings: { ...DEFAULT_SETTINGS }, guardEnabledAt: null, updatedAt: now, run: { phase: 'idle', lastSeq: -1 }, retry: { attempt: 0, retryAt: null }, recovery: { status: 'not_needed', reasonCode: 'no_unfinished_work', reason: '暂无待恢复的运行记录。' }, audit: [] };
}
export function sessionKey(id) { return createHash('sha256').update(id).digest('hex'); }

/** A loopback socket is an OS-owned mutex, not an application HTTP server.
 * The OS releases it after kill/reboot. A collision fails closed; no stale PID lock is stolen.
 * All profiles under one data home share the lease because their storage routes may coincide.
 */
export async function acquireLease({ identity = process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), onLost = () => {} } = {}) {
  const hash = createHash('sha256').update(path.resolve(identity)).digest().readUInt32BE(0);
  const port = 42000 + hash % 20000;
  const server = net.createServer(socket => socket.destroy());
  await new Promise((resolve, reject) => {
    const fail = error => { server.close(); reject(new Error(`Task Guardian lease unavailable (${error.code || 'bind_failed'}); another Host or a port collision requires confirmation.`)); };
    server.once('error', fail);
    server.listen({ port, host: '127.0.0.1', exclusive: true }, () => { server.removeListener('error', fail); resolve(); });
  });
  let closed = false;
  server.on('error', error => { if (!closed) onLost(error); });
  server.unref();
  return { port, close: () => new Promise(resolve => { if (closed) return resolve(); closed = true; server.close(() => resolve()); }) };
}

/** Native storage-domain supplies serialized, durable writes. Authorization and run state
 * share one record/revision, so a persisted revocation cannot be overwritten by an older retry.
 * The short audit tail is atomic with state; the separate audit table retains full history.
 */
export async function createGuardianStore(storageDomain, { ownerId = randomUUID(), now = Date.now } = {}) {
  const domain = await storageDomain.open({ name: 'task_guardian', version: 1, layout: 'per-record', tables: { sessions: { valueSchema: recordSchema }, audit: { valueSchema: jsonObjectSchema }, config: { valueSchema: jsonObjectSchema } } });
  const sessions = domain.table('sessions');
  const history = domain.table('audit');
  let chain = Promise.resolve(), closed = false, failure;
  const get = id => structuredClone(sessions.get(sessionKey(id)) || defaultRecord(id, now()));
  const update = (id, kind, change) => {
    if (closed || failure) return Promise.reject(failure || new Error('Task Guardian store is closed.'));
    const operation = chain.then(async () => {
      if (failure) throw failure;
      const current = get(id);
      const changed = await change(structuredClone(current));
      if (changed === undefined) return current;
      const at = now(), revision = current.revision + 1;
      const entry = { id: randomUUID(), sessionId: id, revision, at, kind, ownerId };
      const next = recordSchema.parse({ ...changed, version: 1, sessionId: id, revision, updatedAt: at, audit: [...current.audit, entry].slice(-64) });
      try {
        await sessions.put(sessionKey(id), next);
        // A failed audit publication leaves the primary state and its short audit tail durable.
        await history.put(entry.id, { ...entry, settings: next.settings, epoch: next.epoch, run: next.run, retry: next.retry, decision: next.lastDecision ?? null, recovery: next.recovery });
      } catch (error) { failure = error; throw error; }
      return structuredClone(next);
    });
    chain = operation.catch(() => {});
    return operation;
  };
  return {
    ownerId, get, update,
    getStartup: () => structuredClone(domain.table('config').get('startup') || { enabled: false }),
    setStartup(value) { if (closed || failure) return Promise.reject(failure || new Error('Task Guardian store is closed.')); const job = chain.then(async () => { if (failure) throw failure; await domain.table('config').put('startup', jsonObjectSchema.parse(value)); }); chain = job.catch(error => { failure = error; }); return job; },
    list: () => [...sessions.entries()].map(([, value]) => structuredClone(value)),
    healthy: () => !closed && !failure,
    async close() { closed = true; await chain; await domain.close(); },
  };
}

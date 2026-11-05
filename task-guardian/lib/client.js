window.__ModuleLoader__.load({
  id: 'dsh-task-guardian',
  factory: require => {
    const React = require('react');
    const h = React.createElement;
    const ID = 'dsh-task-guardian', NS = 'taskGuardian', ACCESSORY = 'capability-selector.accessories';
    const ZH = {
      title: '任务异常提醒', unread: '未读', refresh: '刷新', next: '下次重试', attempts: '次', stopped: '已停止',
      alertsLoading: '正在连接任务提醒…', alertsOffline: '提醒连接中断，保留上次记录；正在重连。',
      alertsUnavailable: '任务异常提醒暂不可用，请刷新或检查插件是否已更新。', fault: '任务异常提醒暂不可用，请检查持久存储或插件状态。',
      alertsEmpty: '暂无未读异常提醒', alertsMore: '还有更多未读提醒，标记已读后会继续加载。',
      alertsExpand: '展开提醒', alertsCollapse: '收起提醒', viewSession: '查看会话', markRead: '标记已读', markingRead: '正在标记…',
      alertFailed: '已中断，需要处理', alertRetrying: '长时间重试中', alertResumed: '已恢复执行，尚未确认完成',
      alertResolved: '故障已解除', alertUnknown: '状态待确认', unnamedSession: '未命名会话',
      alertOpenFailed: '无法打开会话，请从会话列表查看；提醒仍保留。', alertAckFailed: '标记已读失败，提醒仍保留，请重试。',
      alertsUpdated: '上次更新', markAllRead: '一键全部已读', markingAllRead: '正在全部标记…',
      bulkUnavailable: '一键已读需要有效提醒快照，请刷新后重试。', alertSnapshotChanged: '提醒快照已更新，已刷新列表，请重新点击全部已读。',
    };
    const EN = {
      title: 'Task alerts', unread: 'unread', refresh: 'Refresh', next: 'Next retry', attempts: 'attempts', stopped: 'Stopped',
      alertsLoading: 'Connecting task alerts…', alertsOffline: 'Alerts are offline. Previous records are retained; reconnecting.',
      alertsUnavailable: 'Task alerts are unavailable. Refresh or check that the plugin has been updated.', fault: 'Task alerts are unavailable. Check durable storage or the plugin status.',
      alertsEmpty: 'No unread task alerts', alertsMore: 'More unread alerts will load after you mark these as read.',
      alertsExpand: 'Expand alerts', alertsCollapse: 'Collapse alerts', viewSession: 'View session', markRead: 'Mark as read', markingRead: 'Marking…',
      alertFailed: 'Interrupted; needs attention', alertRetrying: 'Retrying for an extended time', alertResumed: 'Execution resumed; completion not yet confirmed',
      alertResolved: 'Failure resolved', alertUnknown: 'Status unconfirmed', unnamedSession: 'Untitled session',
      alertOpenFailed: 'Could not open the session. Find it in the session list; the alert is retained.', alertAckFailed: 'Could not mark as read. The alert is retained; try again.',
      alertsUpdated: 'Last updated', markAllRead: 'Mark all as read', markingAllRead: 'Marking all…',
      bulkUnavailable: 'Mark all requires a current alert snapshot. Refresh and try again.', alertSnapshotChanged: 'The alert snapshot changed. The list was refreshed; select Mark all again.',
    };
    const CSS = `.dta{box-sizing:border-box;color:var(--dsw-alias-label-primary);font:13px/1.55 system-ui,sans-serif;min-width:0}.dta *{box-sizing:border-box}.dta-card{width:100%;padding:10px 12px;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-xl);overflow:hidden}.dta p{margin:7px 0;overflow-wrap:anywhere}.dta-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-height:30px}.dta-title{font-weight:600;display:flex;gap:8px;align-items:center}.dta-title svg{flex:none}.dta-count{border:1px solid var(--dsw-alias-border-l3);border-radius:12px;padding:0 8px;font-variant-numeric:tabular-nums}.dta-tools{display:flex;gap:8px;margin-inline-start:auto;flex-wrap:wrap;justify-content:flex-end;max-width:100%}.dta-warning{margin:4px 0;font-weight:600;overflow-wrap:anywhere}.dta-note{color:var(--dsw-alias-label-secondary);font-size:12px}.dta-list{margin:6px 0 0;padding:0;list-style:none;max-height:min(28vh,240px);overflow:auto;overscroll-behavior:contain}.dta-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 16px;padding:8px 0;border-top:1px solid var(--dsw-alias-border-l1)}.dta-summary{min-width:0;overflow-wrap:anywhere}.dta-summary strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dta-message{margin:3px 0!important;white-space:pre-wrap;max-height:4.6em;overflow:auto;color:var(--dsw-alias-label-secondary)}.dta-meta{font-size:11px;color:var(--dsw-alias-label-tertiary)}.dta-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.dta-button{padding:4px 8px;min-height:28px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:inherit;font:inherit;cursor:pointer;white-space:nowrap}.dta-button:hover{background:var(--dsw-alias-interactive-bg-hover)}.dta-button:disabled{opacity:.5;cursor:default}.dta-button:focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:2px}@media(max-width:600px){.dta-row{grid-template-columns:minmax(0,1fr)}.dta-actions{justify-content:flex-end}}@media(max-height:400px){.dta-list{max-height:22vh}.dta-card{padding:6px 10px}}`;
    function NoticeBell({ size = 20 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: 'M9 20a3 3 0 0 0 6 0M5 17h14c-2-2-2-4-2-7a5 5 0 0 0-10 0c0 3 0 5-2 7ZM12 3v2' }));
    }
    function date(value) { if (!Number.isFinite(value)) return '—'; return new Date(value).toLocaleString(); }
    const ACTIONS = new Set(['alerts', 'acknowledge', 'acknowledgeAll']);
    async function requestJSON(fetchImpl, action, payload, signal) {
      if (!ACTIONS.has(action)) throw Object.assign(new Error('unsupported_action'), { code: 'unsupported_action' });
      const response = await fetchImpl(`/api/task-guardian/${action}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal });
      if (!response.ok) {
        let result; try { result = await response.json(); } catch { /* older Hosts can return HTML */ }
        throw Object.assign(new Error(result?.error || 'operation_failed'), { code: result?.error || 'operation_failed', status: response.status });
      }
      let result; try { result = await response.json(); } catch { throw Object.assign(new Error('invalid_response'), { code: 'invalid_response' }); }
      if (!result?.ok) throw Object.assign(new Error(result?.error || 'operation_failed'), { code: result?.error || 'operation_failed' });
      return result;
    }
    function alertStatusText(alert, t) {
      if (alert.resolution === 'stopped') return t('stopped');
      return t({ failed: 'alertFailed', retrying: 'alertRetrying', resumed: 'alertResumed', resolved: 'alertResolved' }[alert.state] || 'alertUnknown');
    }
    /** One passive catalog poll for the plugin lifetime, independent of the selected session. */
    function createAlertStore(api, { pollMs = 3000, timeoutMs = 10000, schedule = setTimeout, unschedule = clearTimeout } = {}) {
      let state = { alerts: [], total: 0, hasMore: false, readToken: null, bulkBusy: false, fault: null, status: 'loading', collapsed: false, busy: [], actionError: null, serverNow: null };
      const listeners = new Set(), controllers = new Set();
      let started = false, disposed = false, timer, pending, generation = 0;
      const publish = patch => { if (!disposed) { state = { ...state, ...patch }; for (const listener of listeners) listener(); } };
      const keyOf = alert => JSON.stringify([alert.sessionId, alert.id]);
      async function request(action, payload) {
        const controller = new AbortController(); controllers.add(controller);
        let rejectAbort;
        const aborted = new Promise((_, reject) => { rejectAbort = () => reject(Object.assign(new Error('request_timeout'), { code: 'request_timeout' })); controller.signal.addEventListener('abort', rejectAbort, { once: true }); });
        const deadline = schedule(() => controller.abort(), timeoutMs);
        try { return await Promise.race([api(action, payload, controller.signal), aborted]); }
        finally { unschedule(deadline); controller.signal.removeEventListener('abort', rejectAbort); controllers.delete(controller); }
      }
      function refresh() {
        if (disposed || state.busy.length || state.bulkBusy) return Promise.resolve();
        if (pending) return pending;
        unschedule(timer);
        const requestGeneration = generation;
        pending = (async () => {
          try {
            const value = await request('alerts', {});
            if (!Array.isArray(value.alerts) || value.mode !== 'alerts-only') throw Object.assign(new Error('invalid_response'), { code: 'invalid_response' });
            if (disposed || requestGeneration !== generation) return;
            const seen = new Set();
            const alerts = value.alerts.filter(alert => {
              if (!alert || typeof alert.id !== 'string' || !alert.id || typeof alert.sessionId !== 'string' || !alert.sessionId || alert.acknowledged === true) return false;
              const key = keyOf(alert); if (seen.has(key)) return false; seen.add(key); return true;
            });
            const hasMore = value.hasMore === true;
            const total = hasMore && Number.isSafeInteger(value.total) ? Math.max(alerts.length, value.total) : alerts.length;
            publish({ alerts, total, hasMore, readToken: typeof value.readToken === 'string' && value.readToken ? value.readToken : null, fault: value.fault || null, status: 'online', serverNow: Number.isFinite(value.serverNow) ? value.serverNow : null });
          } catch (error) {
            if (!disposed && requestGeneration === generation) publish({ status: [404, 405, 501].includes(error.status) || error.code === 'invalid_response' ? 'unavailable' : 'offline' });
          } finally {
            pending = null;
            if (started && !disposed) timer = schedule(() => { void refresh(); }, pollMs);
          }
        })();
        return pending;
      }
      async function acknowledge(alert) {
        const key = keyOf(alert);
        if (disposed || state.bulkBusy || state.busy.includes(key)) return;
        generation++;
        publish({ busy: [...state.busy, key], actionError: null });
        try {
          await request('acknowledge', { sessionId: alert.sessionId, alertId: alert.id });
          if (disposed) return;
          const alerts = state.alerts.filter(item => keyOf(item) !== key);
          publish({ alerts, total: Math.max(alerts.length, state.total - 1) });
        } catch { publish({ actionError: 'alertAckFailed' }); }
        finally {
          if (!disposed) {
            publish({ busy: state.busy.filter(item => item !== key) });
            if (pending) await pending;
            if (!disposed) await refresh();
          }
        }
      }
      async function acknowledgeAll() {
        if (disposed || state.bulkBusy || state.busy.length || state.status !== 'online' || !state.readToken || !state.total) return;
        const readToken = state.readToken;
        generation++;
        publish({ bulkBusy: true, actionError: null });
        try { await request('acknowledgeAll', { readToken }); }
        catch (error) { publish({ actionError: error.status === 409 ? 'alertSnapshotChanged' : 'alertAckFailed' }); }
        finally {
          if (!disposed) {
            publish({ bulkBusy: false, readToken: null });
            if (pending) await pending;
            if (!disposed) await refresh();
          }
        }
      }
      return {
        getSnapshot: () => state,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        start() { if (started || disposed) return; started = true; void refresh(); },
        refresh, acknowledge, acknowledgeAll,
        toggle() { publish({ collapsed: !state.collapsed }); },
        actionFailed(code) { publish({ actionError: code }); },
        dispose() { disposed = true; generation++; unschedule(timer); for (const controller of controllers) controller.abort(); listeners.clear(); },
      };
    }
    function AlertContent({ value, store, open, t, contentId = 'dta-alert-list' }) {
      const alerts = value.alerts.filter(alert => alert.acknowledged !== true);
      const status = value.status === 'loading' ? t('alertsLoading') : value.status === 'unavailable' ? t('alertsUnavailable') : value.status === 'offline' ? t('alertsOffline') : null;
      const navigate = alert => {
        try { Promise.resolve(open(alert.sessionId)).catch(() => store.actionFailed('alertOpenFailed')); }
        catch { store.actionFailed('alertOpenFailed'); }
      };
      const count = Math.max(alerts.length, value.total || 0);
      return h('section', { className: 'dta dta-card', 'aria-label': t('title'), 'data-task-alerts': true },
        h('style', null, CSS),
        h('div', { className: 'dta-head' },
          h('div', { className: 'dta-title', role: 'status', 'aria-live': 'polite', 'aria-atomic': true }, h(NoticeBell, { size: 20 }), t('title'), h('span', { className: 'dta-count' }, `${count} ${t('unread')}`)),
          h('div', { className: 'dta-tools' },
            h('button', { type: 'button', className: 'dta-button', onClick: () => { void store.acknowledgeAll(); }, disabled: value.bulkBusy || value.busy.length > 0 || value.status !== 'online' || !value.readToken || count === 0, title: !value.readToken ? t('bulkUnavailable') : t('markAllRead') }, t(value.bulkBusy ? 'markingAllRead' : 'markAllRead')),
            h('button', { type: 'button', className: 'dta-button', onClick: () => { void store.refresh(); } }, t('refresh')),
            h('button', { type: 'button', className: 'dta-button', 'aria-expanded': !value.collapsed, 'aria-controls': contentId, onClick: store.toggle }, t(value.collapsed ? 'alertsExpand' : 'alertsCollapse')))),
        status && h('p', { className: 'dta-warning', role: 'status' }, status),
        value.fault && h('p', { className: 'dta-warning', role: 'status' }, t('fault')),
        value.actionError && h('p', { className: 'dta-warning', role: 'alert' }, t(value.actionError)),
        !value.collapsed && h('div', { id: contentId },
          !alerts.length && value.status === 'online' && h('p', { className: 'dta-note' }, t('alertsEmpty')),
          h('ul', { className: 'dta-list' }, ...alerts.map(alert => {
            const title = typeof alert.title === 'string' && alert.title.trim() ? alert.title : t('unnamedSession');
            const busy = value.bulkBusy || value.busy.includes(JSON.stringify([alert.sessionId, alert.id]));
            return h('li', { className: 'dta-row', key: JSON.stringify([alert.sessionId, alert.id]), 'data-alert-session': alert.sessionId },
              h('div', { className: 'dta-summary' }, h('strong', { title }, title), h('span', null, alertStatusText(alert, t)),
                typeof alert.message === 'string' && alert.message && h('p', { className: 'dta-message' }, alert.message),
                h('div', { className: 'dta-meta' }, [date(alert.at), typeof alert.code === 'string' && alert.code].filter(Boolean).join(' · ')),
                alert.state === 'retrying' && Number.isFinite(alert.nextRetryAt) && h('div', { className: 'dta-meta' }, `${t('next')} ${date(alert.nextRetryAt)}${Number.isFinite(alert.attempt) ? ` · ${alert.attempt} ${t('attempts')}` : ''}`)),
              h('div', { className: 'dta-actions' },
                h('button', { type: 'button', className: 'dta-button', onClick: () => navigate(alert), 'aria-label': `${t('viewSession')} · ${title}` }, t('viewSession')),
                h('button', { type: 'button', className: 'dta-button', disabled: busy, onClick: () => { void store.acknowledge(alert); }, 'aria-label': `${t('markRead')} · ${title}` }, t(busy ? 'markingRead' : 'markRead'))));
          })),
          value.hasMore && h('p', { className: 'dta-note' }, t('alertsMore')),
          value.serverNow !== null && value.status !== 'online' && h('p', { className: 'dta-meta' }, `${t('alertsUpdated')} ${date(value.serverNow)}`)));
    }
    function TaskAlertsCard({ store, open, t }) {
      const value = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
      const contentId = React.useId();
      React.useEffect(() => { store.start(); }, [store]);
      return h(AlertContent, { value, store, open, t, contentId });
    }
    const inject = ['slots', 'locale', 'uiWorkspace'];
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }));
      const transport = globalThis.__DSH_TRANSPORT__;
      const fetchImpl = transport?.fetch ? transport.fetch.bind(transport) : (...args) => globalThis.fetch(...args);
      const store = createAlertStore((action, payload, signal) => requestJSON(fetchImpl, action, payload, signal));
      ctx.effect(() => () => store.dispose());
      ctx.slots.inject(ACCESSORY, () => ctx.slots.register({ name: ACCESSORY, id: ID, order: 100, locale: NS,
        inject: () => ({ store, open: sessionId => ctx.uiWorkspace.openSession(sessionId) }) }, TaskAlertsCard));
    }
    return { apply, inject, TaskAlertsCard, AlertContent, createAlertStore, alertStatusText, NoticeBell, ZH, EN, CSS, requestJSON };
  },
});

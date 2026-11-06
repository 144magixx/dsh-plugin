window.__ModuleLoader__.load({
  id: 'dsh-session-favorites',
  factory(require) {
    const React = require('react'), h = React.createElement;
    const NS = 'session-favorites', SLOT = 'capability-selector.accessories';
    const ZH = {
      title: '常用对话', add: '添加对话', close: '关闭添加列表', current: '当前', addCurrent: '加入当前对话', added: '已添加',
      empty: '把常用对话放在这里，随时继续。', search: '搜索对话', placeholder: '搜索标题或工作区…', loading: '正在读取…',
      none: '没有找到匹配的对话', remove: '从常用对话移除', addOne: '添加到常用对话', open: '打开对话', untitled: '未命名对话',
      unavailable: '暂时无法读取', retry: '重试', more: '加载更多', failure: '操作未完成，请重试。', sync: '同步暂时中断',
      limit: '常用对话已达上限，请先移除部分对话。', ordinary: '请添加主对话，子智能体可从原对话中查看。',
      count: '{count} 个', resultCount: '找到 {count} 个对话', refresh: '刷新常用对话', collapse: '收起常用对话', expand: '展开常用对话',
    };
    const EN = {
      title: 'Favorite conversations', add: 'Add conversation', close: 'Close conversation picker', current: 'Current', addCurrent: 'Add current conversation', added: 'Added',
      empty: 'Keep conversations here to return to them quickly.', search: 'Search conversations', placeholder: 'Search titles or workspaces…', loading: 'Loading…',
      none: 'No matching conversations', remove: 'Remove from favorites', addOne: 'Add to favorites', open: 'Open conversation', untitled: 'Untitled conversation',
      unavailable: 'Temporarily unavailable', retry: 'Retry', more: 'Load more', failure: 'The operation failed. Please retry.', sync: 'Live updates disconnected',
      limit: 'The favorites limit was reached. Remove a conversation first.', ordinary: 'Add the main conversation. Subagents remain available from their parent.',
      count: '{count}', resultCount: '{count} conversations found', refresh: 'Refresh favorites', collapse: 'Collapse favorites', expand: 'Expand favorites',
    };
    ZH.completed = '有新完成结果'; ZH.question = '等待你回答'; ZH.statusUnknown = '状态暂不可用'; ZH.running = '进行中';
    EN.completed = 'New completed result'; EN.question = 'Waiting for your answer'; EN.statusUnknown = 'Status unavailable'; EN.running = 'In progress';
    const CSS = `
.dsf{box-sizing:border-box;width:100%;min-width:0;padding:12px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:16px;font:13px/1.5 system-ui,sans-serif}
.dsf *{box-sizing:border-box}.dsf button,.dsf input{font:inherit}.dsf button{color:inherit;cursor:pointer}.dsf button:disabled{opacity:.5;cursor:default}.dsf button:focus-visible,.dsf input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dsf-head{display:flex;align-items:center;gap:6px;min-width:0}.dsf-heading{display:flex;align-items:center;gap:9px;flex:1;min-width:0;padding:2px 0;border:0;background:transparent;text-align:left;font-weight:600!important;font-size:14px!important}.dsf-heading>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsf-heading small{font-size:11px;color:var(--dsw-alias-label-secondary);font-weight:400}.dsf-icon{display:flex;align-items:center;justify-content:center;flex:none;border:0;border-radius:7px;background:transparent;width:28px;height:28px;padding:5px}.dsf-icon:hover{background:var(--dsw-alias-bg-layer-2)}.dsf svg{flex:none}
.dsf-body{margin-top:9px}.dsf-note{margin:9px 0;color:var(--dsw-alias-label-secondary);font-size:12px;overflow-wrap:anywhere}.dsf-list{list-style:none;margin:0;padding:0;max-height:280px;overflow-y:auto;overscroll-behavior:contain}.dsf-row{display:flex;align-items:center;gap:3px;border-radius:9px;margin:2px 0;min-width:0}.dsf-row:hover{background:var(--dsw-alias-bg-layer-2)}.dsf-row[data-current=true]{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 9%,var(--dsw-alias-bg-layer-1))}.dsf-link{flex:1;min-width:0;padding:8px 7px;display:flex;gap:8px;align-items:center;background:transparent;border:0;text-align:left;border-radius:8px}.dsf-label{min-width:0;flex:1}.dsf-title{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}.dsf-detail{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:1px}.dsf-mark{font-size:10px;flex:none;color:var(--dsw-alias-brand-primary)}.dsf-remove{color:var(--dsw-alias-label-secondary)!important}.dsf-button{border:1px solid var(--dsw-alias-border-l1);background:transparent;border-radius:8px;padding:5px 9px;font-size:12px!important}.dsf-button:hover{background:var(--dsw-alias-bg-layer-2)}.dsf-add-current{margin-top:8px;color:var(--dsw-alias-brand-primary)!important;display:flex;align-items:center;justify-content:center;gap:5px;width:100%}.dsf-picker{border-top:1px solid var(--dsw-alias-border-l1);padding-top:10px;margin-top:10px}.dsf-search{display:block;width:100%;background:var(--dsw-alias-bg-base);color:inherit;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:7px 9px;min-width:0}.dsf-search::placeholder{color:var(--dsw-alias-label-secondary)}.dsf-results{max-height:240px}.dsf-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:5px}.dsf-error{color:var(--dsw-alias-state-error-primary);font-size:12px;display:flex;align-items:center;gap:6px;margin-top:8px}.dsf-error span{flex:1}.dsf-check{color:var(--dsw-alias-brand-primary)}
.dsf-dot{display:inline-block;flex:none;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-success-primary)}.dsf-dot[data-attention=question]{background:var(--dsw-alias-state-warn-primary)}.dsf-dot[data-attention=unknown]{background:var(--dsw-alias-state-idle-primary)}
.dsf-spin{display:inline-block;flex:none;box-sizing:border-box;width:14px;height:14px;margin:0 1px;border-radius:50%;border:1.6px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 22%,transparent);border-top-color:var(--dsw-alias-brand-primary);animation:dsf-spin .8s linear infinite}@keyframes dsf-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.dsf-spin{animation-duration:2.4s}}
@media(max-height:500px){.dsf-list{max-height:140px}.dsf-results{max-height:140px}}
`;
    function Icon({ kind = 'chat', size = 18 }) {
      const paths = {
        star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z',
        plus: 'M12 5v14M5 12h14', close: 'm6 6 12 12M6 18 18 6',
        chat: 'M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4H3V6a2 2 0 0 1 2-2Z',
        check: 'm5 12 4 4L19 6', chevron: 'm9 5 7 7-7 7',
      };
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: paths[kind] }));
    }
    function createController(request, fetchImpl, { now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
      let state = { items: [], revision: -1, loading: true, error: '', busy: false, disconnected: false };
      const listeners = new Set(), lifetime = new AbortController();
      let disposed = false, serial = 0, refreshing, queued = false, reconnectTimer, watchAbort;
      let watching = false, restart = false, started = false, failures = 0, cursor, observedRevision = -1;
      const set = patch => { if (disposed) return; state = { ...state, ...patch }; for (const listener of listeners) listener(); };
      function accept(value) {
        if (value.revision < state.revision) return;
        const old = new Map(state.items.map(item => [item.sessionId, item]));
        set({ revision: value.revision, items: value.items.map(item => ({ ...old.get(item.sessionId), ...item })), error: '', loading: false });
      }
      async function refresh() {
        if (disposed) return;
        if (refreshing) { queued = true; return refreshing; }
        const at = serial;
        refreshing = request({ action: 'list' }, lifetime.signal).then(value => { if (at === serial) { accept(value); if (value.revision < observedRevision) queued = true; } }).catch(error => { if (!disposed) set({ error: error.code || 'operation_failed', loading: false }); }).finally(() => { refreshing = null; if (queued && !disposed) { queued = false; void refresh(); } });
        return refreshing;
      }
      async function change(action, sessionId, throughSeq) {
        if (state.busy || disposed) return false;
        serial++; set({ busy: true, error: '' });
        try { accept(await request({ action, sessionId, ...(throughSeq === undefined ? {} : { throughSeq }) }, lifetime.signal)); void refresh(); return true; }
        catch (error) { if (!disposed) set({ error: error.code || 'operation_failed' }); return false; }
        finally { set({ busy: false }); }
      }
      function requestWatch() {
        clearTimer(reconnectTimer); reconnectTimer = undefined;
        if (disposed) return;
        if (watching) { restart = true; watchAbort.abort(); }
        else void watch();
      }
      async function watch() {
        if (disposed || watching) return;
        watching = true; restart = false;
        const abort = new AbortController(); watchAbort = abort;
        const signal = AbortSignal.any([abort.signal, lifetime.signal]), at = now();
        let reader, delay, received = false;
        const cancel = () => { void reader?.cancel().catch(() => {}); };
        try {
          const response = await fetchImpl('/api/session-favorites/changes', { credentials: 'same-origin', signal });
          if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error('stream_unavailable'); }
          reader = response.body.getReader(); const decoder = new TextDecoder(); let pending = '';
          signal.addEventListener('abort', cancel, { once: true });
          if (signal.aborted) cancel();
          while (!signal.aborted) {
            const next = await reader.read();
            if (signal.aborted) break;
            if (next.done) {
              if (!received || pending.trim()) throw new Error('invalid_stream');
              // Normal expiry: retain data and allow the next short subscription.
              failures = 0; delay = Math.max(150, 2500 - (now() - at)); break;
            }
            pending += decoder.decode(next.value, { stream: true });
            let end;
            while ((end = pending.indexOf('\n')) >= 0) {
              if (end > 4096) throw new Error('invalid_stream');
              const line = pending.slice(0, end); pending = pending.slice(end + 1);
              if (!line.trim()) continue;
              const frame = JSON.parse(line);
              if (!Number.isSafeInteger(frame.revision) || typeof frame.cursor !== 'string') throw new Error('invalid_stream');
              observedRevision = frame.revision;
              const changed = frame.activity || (frame.revision > state.revision && !state.loading) || (cursor !== undefined && frame.cursor !== cursor);
              cursor = frame.cursor; received = true;
              if (state.disconnected) { set({ disconnected: false }); void refresh(); }
              else if (changed) void refresh();
            }
            if (pending.length > 4096) throw new Error('invalid_stream');
          }
        } catch {
          if (!disposed && !signal.aborted) {
            set({ disconnected: true });
            delay = Math.min(10000, 1000 * 2 ** Math.min(failures++, 4));
          }
        } finally {
          signal.removeEventListener('abort', cancel);
          try { await reader?.cancel(); } catch {} reader?.releaseLock();
          watching = false; watchAbort = undefined;
          if (!disposed) {
            if (restart) requestWatch();
            else if (delay !== undefined) reconnectTimer = setTimer(requestWatch, delay);
          }
        }
      }
      return {
        getSnapshot: () => state, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        refresh, change, search: (input, signal) => request({ ...input, action: 'search' }, signal),
        start() { if (started || disposed) return; started = true; void refresh(); requestWatch(); }, retry() { if (disposed) return; void refresh(); requestWatch(); },
        dispose() { disposed = true; lifetime.abort(); watchAbort?.abort(); clearTimer(reconnectTimer); listeners.clear(); },
      };
    }
    function Picker({ api, selected, busy, t }) {
      const [query, setQuery] = React.useState(''), [result, setResult] = React.useState({ items: [], total: 0, nextOffset: null }), [loading, setLoading] = React.useState(true), [error, setError] = React.useState(false), [attempt, setAttempt] = React.useState(0);
      const abortRef = React.useRef(), generation = React.useRef(0);
      const load = React.useCallback(async (offset = 0) => {
        abortRef.current?.abort(); const abort = new AbortController(); abortRef.current = abort; const gen = ++generation.current;
        setLoading(true); setError(false);
        try {
          const value = await api.search({ query, offset, limit: 30 }, abort.signal);
          if (gen === generation.current && !abort.signal.aborted) setResult(previous => ({ ...value, items: offset ? [...previous.items, ...value.items] : value.items }));
        } catch { if (!abort.signal.aborted) setError(true); }
        finally { if (gen === generation.current && !abort.signal.aborted) setLoading(false); }
      }, [api, query]);
      React.useEffect(() => { setResult({ items: [], total: 0, nextOffset: null }); setLoading(true); const timer = setTimeout(() => void load(), 180); return () => { clearTimeout(timer); abortRef.current?.abort(); generation.current++; }; }, [load, attempt]);
      return h('div', { className: 'dsf-picker' },
        h('input', { type: 'search', className: 'dsf-search', value: query, autoFocus: true, 'aria-label': t('search'), placeholder: t('placeholder'), onChange: event => setQuery(event.target.value) }),
        h('ul', { className: 'dsf-list dsf-results', 'aria-label': t('search') }, ...result.items.map(item => {
          const added = selected.has(item.sessionId), title = item.title || t('untitled');
          return h('li', { key: item.sessionId, className: 'dsf-row' }, h('button', { className: 'dsf-link', type: 'button', disabled: busy || added, title, 'aria-label': `${t(added ? 'added' : 'addOne')}: ${title}`, onClick: () => void api.change('add', item.sessionId) },
            h('span', { className: 'dsf-label' }, h('span', { className: 'dsf-title' }, title), h('span', { className: 'dsf-detail', title: item.cwd }, item.workspace || basename(item.cwd) || item.sessionId.slice(0, 8))), h('span', { className: added ? 'dsf-check' : undefined }, h(Icon, { kind: added ? 'check' : 'plus', size: 16 }))));
        })),
        loading && h('p', { className: 'dsf-note', role: 'status' }, t('loading')),
        !loading && !error && result.items.length === 0 && h('p', { className: 'dsf-note' }, t('none')),
        error && h('div', { className: 'dsf-error', role: 'alert' }, h('span', null, t('failure')), h('button', { type: 'button', className: 'dsf-button', onClick: () => setAttempt(value => value + 1) }, t('retry'))),
        !loading && result.items.length > 0 && h('div', { className: 'dsf-footer' }, h('small', { className: 'dsf-detail' }, t('resultCount', { count: result.total })), result.nextOffset !== null && h('button', { type: 'button', className: 'dsf-button', onClick: () => void load(result.nextOffset) }, t('more'))));
    }
    function basename(value) { return String(value || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop(); }
    function Dot({ status, t }) {
      if (!['completed', 'question', 'unknown'].includes(status)) return null;
      const label = t(status === 'unknown' ? 'statusUnknown' : status);
      return h('span', { className: 'dsf-dot', 'data-attention': status, role: 'img', 'aria-label': label, title: label });
    }
    function Spinner({ t }) { return h('span', { className: 'dsf-spin', role: 'img', 'aria-label': t('running'), title: t('running') }) }
    function rowMark(item, t) {
      if (item.attention === 'question') return h(Dot, { status: 'question', t })
      if (item.running) return h(Spinner, { t })
      return ['completed', 'unknown'].includes(item.attention) ? h(Dot, { status: item.attention, t }) : h(Icon, { size: 15 })
    }
    function FavoritesCard({ sessionId, api, navigate, t }) {
      const state = React.useSyncExternalStore(api.subscribe, api.getSnapshot, api.getSnapshot);
      const [expanded, setExpanded] = React.useState(true), [picker, setPicker] = React.useState(false), [openError, setOpenError] = React.useState(false);
      const trigger = React.useRef(null), seenAttempt = React.useRef(''), regionId = React.useId();
      const selected = new Set(state.items.map(item => item.sessionId));
      const overall = state.items.some(item => item.attention === 'question') ? 'question' : state.items.some(item => item.attention === 'completed') ? 'completed' : 'none';
      React.useEffect(() => {
        const item = state.items.find(item => item.sessionId === sessionId);
        const acknowledge = () => {
          if (!item || !Number.isSafeInteger(item.completedSeq) || item.completedSeq <= (item.seenSeq ?? -1) || item.completedAt < item.addedAt || state.busy || document.visibilityState !== 'visible' || !document.hasFocus()) return;
          const key = `${sessionId}:${item.completedSeq}`;
          if (seenAttempt.current === key) return;
          seenAttempt.current = key;
          void api.change('seen', sessionId, item.completedSeq);
        };
        acknowledge();
        globalThis.addEventListener('focus', acknowledge); document.addEventListener('visibilitychange', acknowledge);
        return () => { globalThis.removeEventListener('focus', acknowledge); document.removeEventListener('visibilitychange', acknowledge); };
      }, [api, sessionId, state.items, state.busy]);
      const closePicker = () => { setPicker(false); trigger.current?.focus(); };
      React.useEffect(() => { void api.refresh(); setOpenError(false); setPicker(false); }, [sessionId, api]);
      const open = id => { try { navigate(id); setOpenError(false); } catch { setOpenError(true); } };
      return h('section', { className: 'dsf', 'data-session-favorites': '', 'aria-label': t('title'), onKeyDown: event => { if (event.key === 'Escape' && picker) { event.preventDefault(); event.stopPropagation(); closePicker(); } } },
        h('style', null, CSS),
        h('div', { className: 'dsf-head' },
          h('button', { type: 'button', className: 'dsf-heading', 'aria-expanded': expanded, 'aria-controls': regionId, title: t(expanded ? 'collapse' : 'expand'), onClick: () => setExpanded(value => !value) }, h(Icon, { kind: 'star', size: 20 }), h('span', null, t('title')), h('small', null, state.items.length || ''), h(Dot, { status: overall, t })),
          h('button', { ref: trigger, type: 'button', className: 'dsf-icon', 'aria-label': t(picker ? 'close' : 'add'), title: t(picker ? 'close' : 'add'), 'aria-expanded': picker && expanded, onClick: () => { setExpanded(true); setPicker(value => !value); } }, h(Icon, { kind: picker ? 'close' : 'plus' }))),
        expanded && h('div', { className: 'dsf-body', id: regionId },
          state.loading && h('p', { className: 'dsf-note', role: 'status' }, t('loading')),
          !state.loading && !state.items.length && !state.error && h('p', { className: 'dsf-note' }, t('empty')),
          h('ul', { className: 'dsf-list', 'aria-label': t('title') }, ...state.items.map(item => {
            const title = item.title || t('untitled'), current = item.sessionId === sessionId;
            return h('li', { className: 'dsf-row', key: item.sessionId, 'data-current': current },
              h('button', { type: 'button', className: 'dsf-link', title, 'aria-label': `${t('open')}: ${title}`, 'aria-current': current ? 'page' : undefined, disabled: item.unavailable, onClick: () => open(item.sessionId) },
                rowMark(item, t), h('span', { className: 'dsf-label' }, h('span', { className: 'dsf-title' }, title), h('span', { className: 'dsf-detail', title: item.cwd }, item.unavailable ? t('unavailable') : item.workspace || basename(item.cwd) || item.sessionId.slice(0, 8))), current && h('span', { className: 'dsf-mark' }, t('current'))),
              h('button', { type: 'button', className: 'dsf-icon dsf-remove', disabled: state.busy, title: t('remove'), 'aria-label': `${t('remove')}: ${title}`, onClick: () => void api.change('remove', item.sessionId) }, h(Icon, { kind: 'close', size: 14 })));
          })),
          sessionId && !selected.has(sessionId) && h('button', { type: 'button', className: 'dsf-button dsf-add-current', disabled: state.busy || state.loading, onClick: () => void api.change('add', sessionId) }, h(Icon, { kind: 'plus', size: 14 }), t('addCurrent')),
          (state.error || openError || state.disconnected) && h('div', { className: 'dsf-error', role: 'alert' }, h('span', null, t(state.error === 'favorites_limit' ? 'limit' : state.error === 'ordinary_sessions_only' ? 'ordinary' : state.error || openError ? 'failure' : 'sync')), h('button', { type: 'button', className: 'dsf-button', onClick: () => { seenAttempt.current = ''; setOpenError(false); api.retry(); } }, t('retry'))),
          picker && h(Picker, { api, selected, busy: state.busy, t })));
    }
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }));
      const transport = globalThis.__DSH_TRANSPORT__;
      const fetchImpl = transport?.fetch ? transport.fetch.bind(transport) : (...args) => globalThis.fetch(...args);
      const request = async (input, signal) => {
        const response = await fetchImpl('/api/session-favorites/action', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), signal });
        const value = await response.json();
        if (!response.ok || value.ok !== true) throw Object.assign(new Error(value.message || 'operation_failed'), { code: value.error || 'operation_failed' });
        return value;
      };
      const api = createController(request, fetchImpl);
      ctx.effect(() => { api.start(); const focus = () => void api.refresh(); globalThis.addEventListener('focus', focus); return () => { globalThis.removeEventListener('focus', focus); api.dispose(); }; });
      ctx.slots.inject(SLOT, () => ctx.slots.register({ name: SLOT, id: 'dsh-session-favorites', order: 50, locale: NS, label: () => ctx.locale.bind(NS)('title'), inject: () => ({ api, navigate: id => ctx.uiWorkspace.openSession(id) }) }, FavoritesCard));
    }
    return { inject: ['slots', 'locale', 'uiWorkspace'], apply, createController, FavoritesCard, Picker, Spinner, rowMark, ZH, EN, CSS };
  },
});

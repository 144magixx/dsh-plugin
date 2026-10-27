window.__ModuleLoader__.load({
  id: 'dsh-task-guardian',
  factory: require => {
    const React = require('react');
    const h = React.createElement;
    const ID = 'dsh-task-guardian', KIND = 'task-guardian', NS = 'taskGuardian';
    const ZH = {
      title: '任务守护', description: '当前会话的重试与恢复审查', details: '详细设置', loading: '正在读取守护状态…', refresh: '刷新', failed: '操作未完成，请刷新后重试。', conflict: '设置已在其他窗口变化，请刷新后重试。',
      enabled: '守护已开启', disabled: '守护已关闭', enable: '任务守护', recovery: '异常退出后自动恢复', auto: '30 分钟后自动选择第一项',
      cost: '无界重试可能长期持续并产生费用；保留当前模型和权限。', first: '选择第一个选项，不一定是推荐项。', gated: '后两项仅在任务守护开启时生效。',
      recoveryLimit: '本版会持久保存恢复偏好和中断证据。因停止撤销与原生目标授权缺少完整持久校验，重启后保持“需要确认”，由你核对后继续。',
      autoLimit: '本版普通问题缺少可靠风险分类和自动来源字段，倒计时结束后仍等待人工回答；不自动提交审批或未知风险答案。',
      retry: '故障守护重试', next: '下次重试', none: '暂无安排', attempts: '次', questions: '待回答问题', noQuestions: '没有可追踪的待回答问题', due: '已到期，等待人工回答', clockUnknown: '创建时间无法确认', firstLabel: '第一项', recoveryResult: '恢复状态', startup: '登录后启动 DSH', startupHint: '全局设置；仅在你明确开启后配置当前用户的系统登录项，下次登录生效。', startupPrerequisites: '断电后仍需系统已开机、已登录且磁盘已解锁；插件不能代为完成这些步骤。', unavailable: '当前 Host 无法确认 Desktop 启动程序。', version: '原生重试兼容检查', versionOk: '当前原生契约已核实', versionBad: '原生版本无法确认或不受支持，故障守护保持停用。', fault: '守护不可用；请检查插件、持久存储或重复 Host。', history: '近期审计记录', noHistory: '暂无记录', session: '当前会话', waiting: '等待重试', running: '运行中', idle: '空闲', stopped: '已停止', completed: '已完成', need_confirmation: '需要确认', startupFailed: '登录项配置未完成，请检查系统权限。',
      restart_review: '启动后审查', restart_review_failed: '启动后审查失败', retry_scheduled: '安排守护重试', retry_cleared: '清除连续失败计数', retry_refused: '停止自动接管', user_settings_changed: '用户修改设置', lifecycle_observed: '记录运行边界', request_observed: '请求已进入原生边界', run_observed: '观察到任务运行',
    };
    const EN = {
      title: 'Task Guardian', description: 'Retries and recovery review for this session', details: 'Settings', loading: 'Reading guardian status…', refresh: 'Refresh', failed: 'The operation failed. Refresh and try again.', conflict: 'Settings changed in another window. Refresh and try again.',
      enabled: 'Guardian on', disabled: 'Guardian off', enable: 'Task Guardian', recovery: 'Recover after abnormal exit', auto: 'Choose the first option after 30 minutes',
      cost: 'Unlimited retries may continue indefinitely and incur charges. The current model and permissions are preserved.', first: 'Chooses the first option, which may not be the recommended option.', gated: 'The last two settings take effect only while Task Guardian is on.',
      recoveryLimit: 'This release persists recovery preferences and interruption evidence. Stop revocation and native goal authorization lack a complete durable fence, so restart recovery requires your review before continuing.',
      autoLimit: 'Ordinary questions lack trusted risk classification and automatic attribution in this version. Expired questions keep waiting for a human answer. Approvals and unknown risks are never submitted automatically.',
      retry: 'Guardian retries', next: 'Next retry', none: 'None scheduled', attempts: 'attempts', questions: 'Pending questions', noQuestions: 'No traceable pending questions', due: 'Expired; waiting for a human answer', clockUnknown: 'Creation time unverified', firstLabel: 'First option', recoveryResult: 'Recovery status', startup: 'Start DSH after login', startupHint: 'Global setting. Configures a per-user system login item only after you enable it. Takes effect next login.', startupPrerequisites: 'The system must be powered on, logged in and its disk unlocked after an outage. The plugin cannot perform these steps.', unavailable: 'This Host cannot identify the Desktop application.', version: 'Native retry compatibility', versionOk: 'Current native contract verified', versionBad: 'The native version is unknown or unsupported. Request guarding remains inactive.', fault: 'Guardian unavailable. Check the plugin, durable storage or duplicate Hosts.', history: 'Recent audit records', noHistory: 'No records yet', session: 'Current session', waiting: 'Waiting to retry', running: 'Running', idle: 'Idle', stopped: 'Stopped', completed: 'Completed', need_confirmation: 'Needs confirmation', startupFailed: 'Login item configuration failed. Check system permissions.',
      restart_review: 'Startup review', restart_review_failed: 'Startup review failed', retry_scheduled: 'Guardian retry scheduled', retry_cleared: 'Failure count cleared', retry_refused: 'Automatic retry declined', user_settings_changed: 'User changed settings', lifecycle_observed: 'Run boundary recorded', request_observed: 'Native request boundary entered', run_observed: 'Task activity observed',
    };
    const CSS = `.dtg{box-sizing:border-box;color:var(--dsw-alias-label-primary);font:13px/1.55 system-ui,sans-serif;min-width:0}.dtg *{box-sizing:border-box}.dtg-panel{height:100%;overflow:auto;padding:20px;display:flex;flex-direction:column;gap:18px}.dtg-guide{width:380px;max-width:100%;padding:14px 20px;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-xl)}.dtg-head,.dtg-setting,.dtg-controls{display:flex;align-items:center;gap:12px}.dtg-head{justify-content:space-between}.dtg-title{display:flex;align-items:center;gap:10px;font-size:15px;font-weight:600;min-width:0}.dtg-title svg{color:var(--dsw-alias-label-secondary);flex:none}.dtg-state{font-size:12px;color:var(--dsw-alias-label-secondary)}.dtg-section{border-top:1px solid var(--dsw-alias-border-l1);padding-top:14px}.dtg-section h3{font-size:13px;margin:0 0 10px;font-weight:600}.dtg p{margin:7px 0;overflow-wrap:anywhere}.dtg-note{color:var(--dsw-alias-label-secondary);font-size:12px}.dtg-setting{justify-content:space-between;padding:9px 0}.dtg-setting span{flex:1;min-width:0}.dtg-switch{flex:none;position:relative;width:34px;height:20px;padding:2px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-interactive-bg-hover);cursor:pointer}.dtg-switch[aria-checked=true]{background:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}.dtg-switch i{display:block;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-bg-base);transition:transform .12s}.dtg-switch[aria-checked=true] i{transform:translateX(13px)}.dtg button:disabled{cursor:default;opacity:.55}.dtg button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:3px}.dtg-button{font:inherit;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-base);color:inherit;padding:5px 10px;cursor:pointer}.dtg-button:hover{background:var(--dsw-alias-interactive-bg-hover)}.dtg-controls{justify-content:space-between;margin-top:10px}.dtg dl{margin:0;display:grid;grid-template-columns:auto minmax(0,1fr);gap:7px 12px}.dtg dt{color:var(--dsw-alias-label-secondary)}.dtg dd{margin:0;overflow-wrap:anywhere}.dtg-question{padding:10px 0;border-top:1px solid var(--dsw-alias-border-l1)}.dtg-question:first-of-type{border-top:0}.dtg-audit{margin:0;padding-left:18px;font-size:12px;color:var(--dsw-alias-label-secondary)}.dtg-audit li{margin:5px 0;overflow-wrap:anywhere}.dtg-badge{padding:7px 10px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1)}.dtg-session{font-size:11px;word-break:break-all;color:var(--dsw-alias-label-tertiary)}@media(prefers-reduced-motion:reduce){.dtg-switch i{transition:none}}`;
    function Shield({ size = 24 }) { return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, 'aria-hidden': true }, h('path', { d: 'M12 2 20 5v7c0 5-5 8-8 10-3-2-8-5-8-10V5z' }), h('path', { d: 'M8.5 10a4 4 0 1 1-.5 5m0-5v3h3' })); }
    function Switch({ label, checked, disabled, onChange }) { return h('button', { type: 'button', className: 'dtg-switch', role: 'switch', 'aria-label': label, 'aria-checked': !!checked, disabled, onClick: () => onChange(!checked) }, h('i')); }
    function duration(ms) { const seconds = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
    function date(value) { if (!Number.isFinite(value)) return '—'; return new Date(value).toLocaleString(); }
    async function requestJSON(fetchImpl, action, payload, signal) {
      const response = await fetchImpl(`/api/task-guardian/${action}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal });
      const result = await response.json();
      if (!response.ok || !result.ok) throw Object.assign(new Error(result.error || 'operation_failed'), { code: result.error });
      return result;
    }
    function useGuardian(sessionId, api) {
      const [value, setValue] = React.useState(null), [error, setError] = React.useState(null), [busy, setBusy] = React.useState(false), [tick, setTick] = React.useState(Date.now());
      const generation = React.useRef(0), active = React.useRef(null), valueRef = React.useRef(value), reads = React.useRef(0), mutating = React.useRef(false);
      valueRef.current = value;
      const load = React.useCallback(async () => {
        if (mutating.current) return;
        const current = generation.current, read = ++reads.current;
        try {
          const data = await api('snapshot', { sessionId }, active.current?.signal);
          if (generation.current === current && read === reads.current && !mutating.current && data.sessionId === sessionId && data.record.revision >= (valueRef.current?.record.revision ?? -1)) {
            const next = { ...data, fetchedAt: Date.now() }; valueRef.current = next; setValue(next); setError(null);
          }
        }
        catch (error) { if (generation.current === current && read === reads.current && !active.current?.signal.aborted) setError(error.code || 'operation_failed'); }
      }, [sessionId, api]);
      React.useEffect(() => {
        generation.current++; reads.current++; mutating.current = false; valueRef.current = null; const controller = new AbortController(); active.current = controller; setValue(null); setError(null); setBusy(false);
        let timer; const refresh = async () => { await load(); if (!controller.signal.aborted) timer = setTimeout(refresh, 5000); };
        void refresh(); const clock = setInterval(() => setTick(Date.now()), 1000);
        return () => { generation.current++; controller.abort(); clearTimeout(timer); clearInterval(clock); };
      }, [sessionId, load]);
      const change = async (key, enabled) => {
        if (mutating.current || !valueRef.current) return;
        const current = generation.current; reads.current++; mutating.current = true; setBusy(true);
        try {
          const result = await api(key === 'startup' ? 'startup' : 'configure', key === 'startup' ? { sessionId, enabled } : { sessionId, settings: { [key]: enabled }, epoch: valueRef.current.record.epoch }, active.current?.signal);
          if (generation.current !== current) return;
          if (key !== 'startup') { const next = { ...result, fetchedAt: Date.now() }; valueRef.current = next; setValue(next); } else { mutating.current = false; await load(); }
          setError(null);
        } catch (error) { if (generation.current === current && !active.current?.signal.aborted) setError(error.code || 'operation_failed'); }
        finally { if (generation.current === current) { mutating.current = false; setBusy(false); } }
      };
      return { value, error, busy, change, load, now: value ? value.serverNow + (tick - value.fetchedAt) : tick };
    }
    function GuardContent({ sessionId, api, t, compact, open }) {
      const state = useGuardian(sessionId, api); const { value, busy, change } = state;
      const settings = value?.record.settings || { enabled: false, recoverAfterRestart: false, autoSelectFirst: false };
      const unavailable = !value || !!value.fault;
      const phase = value?.record.run.phase || 'idle';
      const row = (key, label, disabled) => h('div', { className: 'dtg-setting', key }, h('span', null, label), h(Switch, { label, checked: settings[key], disabled: busy || unavailable || disabled, onChange: next => change(key, next) }));
      return h('section', { className: `dtg ${compact ? 'dtg-guide' : 'dtg-panel'}`, 'data-task-guardian': sessionId },
        h('style', null, CSS),
        h('div', { className: 'dtg-head' }, h('div', { className: 'dtg-title' }, h(Shield), t('title')), h('span', { className: 'dtg-state' }, t(settings.enabled ? 'enabled' : 'disabled'))),
        !value && h('p', { className: 'dtg-note', role: 'status' }, t('loading')),
        state.error && h('p', { className: 'dtg-note', role: 'alert' }, t(state.error === 'settings_changed_reload' ? 'conflict' : 'failed')),
        value?.fault && h('p', { className: 'dtg-badge', role: 'alert' }, t('fault')),
        h('div', null, row('enabled', t('enable')), h('p', { className: 'dtg-note' }, t('cost'))),
        value && h('dl', null, h('dt', null, t('session')), h('dd', null, t(phase)), h('dt', null, t('retry')), h('dd', null, `${value.record.retry.attempt || 0} ${t('attempts')}`), h('dt', null, t('next')), h('dd', null, value.record.retry.retryAt ? `${date(value.record.retry.retryAt)} (${duration(value.record.retry.retryAt - state.now)})` : t('none'))),
        compact ? h('div', { className: 'dtg-controls' }, h('span', { className: 'dtg-note' }, value?.record.recovery.status === 'need_confirmation' ? t('need_confirmation') : t('description')), h('button', { type: 'button', className: 'dtg-button', onClick: open }, t('details'))) : h(React.Fragment, null,
          h('div', { className: 'dtg-section' }, row('recoverAfterRestart', t('recovery'), !settings.enabled), h('p', { className: 'dtg-note' }, t('recoveryLimit')), row('autoSelectFirst', t('auto'), !settings.enabled), h('p', { className: 'dtg-note' }, t('first')), h('p', { className: 'dtg-note' }, t('autoLimit')), h('p', { className: 'dtg-note' }, t('gated'))),
          h('div', { className: 'dtg-section' }, h('h3', null, t('recoveryResult')), h('p', null, value?.record.recovery.reason || t('none')), value?.record.retry.reason && h('p', { className: 'dtg-note' }, value.record.retry.reason)),
          h('div', { className: 'dtg-section' }, h('h3', null, t('questions')), !value?.questions.length && h('p', { className: 'dtg-note' }, t('noQuestions')), ...(value?.questions || []).map(call => h('div', { className: 'dtg-question', key: call.callId }, ...call.questions.map(question => h('div', { key: question.id }, h('p', null, question.question), question.options?.length > 0 && h('p', { className: 'dtg-note' }, `${t('firstLabel')}: ${question.options[0].label}`))), h('p', null, call.deadlineAt === null ? t('clockUnknown') : call.deadlineAt <= state.now ? t('due') : duration(call.deadlineAt - state.now)), h('p', { className: 'dtg-note' }, call.reason)))),
          h('div', { className: 'dtg-section' }, h('h3', null, t('version')), h('p', { className: 'dtg-note' }, t(value?.compatibility.supported ? 'versionOk' : 'versionBad'))),
          h('div', { className: 'dtg-section' }, h('div', { className: 'dtg-setting' }, h('span', null, t('startup')), h(Switch, { label: t('startup'), checked: value?.startup.enabled, disabled: busy || unavailable || !value?.startup.supported, onChange: enabled => change('startup', enabled) })), h('p', { className: 'dtg-note' }, t('startupHint')), !value?.startup.supported && h('p', { className: 'dtg-note' }, t('unavailable')), h('p', { className: 'dtg-note' }, t('startupPrerequisites'))),
          h('div', { className: 'dtg-section' }, h('h3', null, t('history')), value?.record.audit.length ? h('ol', { className: 'dtg-audit' }, ...value.record.audit.slice(-10).reverse().map(entry => h('li', { key: entry.id }, `${date(entry.at)} · ${t(entry.kind)}`))) : h('p', { className: 'dtg-note' }, t('noHistory'))),
          h('div', { className: 'dtg-controls' }, h('span', { className: 'dtg-session' }, sessionId), h('button', { type: 'button', className: 'dtg-button', onClick: state.load, disabled: busy }, t('refresh'))),
        ),
      );
    }
    function GuardianPanel(props) { return h(GuardContent, props); }
    function GuardianGuide(props) { const { tab } = props.useTabInfo(); return h(GuardContent, { ...props, compact: true, open: () => tab.actions.openTab(KIND, { replaceTab: true }) }); }
    const inject = ['slots', 'locale', 'sidebarRightTabs'];
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }));
      const t = ctx.locale.bind(NS);
      const transport = globalThis.__DSH_TRANSPORT__;
      const fetchImpl = transport?.fetch ? transport.fetch.bind(transport) : (...args) => globalThis.fetch(...args);
      const api = (action, payload, signal) => requestJSON(fetchImpl, action, payload, signal);
      ctx.effect(() => ctx.sidebarRightTabs.register({ id: ID, kind: KIND, title: () => t('title'), guide: [{ id: KIND, title: () => t('title'), description: () => t('description'), icon: Shield, order: 100 }] }));
      ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: ID, locale: NS, inject: () => ({ api }) }, GuardianPanel));
      ctx.slots.inject('sidebar.right.tab.guide.entry', () => ctx.slots.register({ name: 'sidebar.right.tab.guide.entry', key: ID, locale: NS, inject: () => ({ api }) }, GuardianGuide));
    }
    return { apply, inject, GuardianPanel, GuardianGuide, Shield, Switch, ZH, EN, CSS, requestJSON, duration };
  },
});

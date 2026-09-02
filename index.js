(() => {
    'use strict';

    const EXT_KEY = 'json_transformer';
    const DEFAULT_PRESET = {
        id: 'kimi-k3-default',
        name: 'Kimi K3 - Reasoning Prefill',
        enabled: true,
        modelKeywords: ['kimi', 'moonshotai/kimi-k3'],
        modify: {
            enabled: true,
            match: {
                role: 'assistant',
                partial: true,
                reasoning_content: '*',
            },
            mode: 'merge',
            value: {
                reasoning_content: '<thinking>',
            },
            deletePaths: [],
            maxMatches: 1,
        },
        add: {
            enabled: false,
            arrayPath: 'messages',
            value: {
                role: 'assistant',
                content: '',
                reasoning_content: '<thinking>',
                partial: true,
            },
            position: {
                type: 'end',
                index: 1,
                match: null,
                relative: 'after',
            },
            maxAdds: 1,
        },
        notifications: {
            noMatch: true,
            noAdd: true,
            errors: true,
        },
    };

    let ctx = null;
    let state = null;
    let originalFetch = null;
    let installed = false;
    let uiBuilt = false;

    const clone = (v) => structuredClone(v);

    function defaultState() {
        return {
            activePresetId: DEFAULT_PRESET.id,
            presets: [clone(DEFAULT_PRESET)],
            settings: {
                globalEnabled: true,
                showDetailedToasts: false,
                hookInternalGeneration: true,
            },
        };
    }

    function normalizeState(raw) {
        const base = defaultState();
        const s = raw && typeof raw === 'object' ? raw : {};
        const presets = Array.isArray(s.presets) && s.presets.length ? s.presets : base.presets;
        const normalized = {
            activePresetId: typeof s.activePresetId === 'string' ? s.activePresetId : base.activePresetId,
            presets: presets.map(normalizePreset),
            settings: {
                globalEnabled: s.settings?.globalEnabled !== false,
                showDetailedToasts: !!s.settings?.showDetailedToasts,
                hookInternalGeneration: s.settings?.hookInternalGeneration !== false,
            },
        };
        if (!normalized.presets.some(p => p.id === normalized.activePresetId)) normalized.activePresetId = normalized.presets[0].id;
        return normalized;
    }

    function normalizePreset(p) {
        const d = clone(DEFAULT_PRESET);
        const x = p && typeof p === 'object' ? p : {};
        const m = x.modify && typeof x.modify === 'object' ? x.modify : {};
        const a = x.add && typeof x.add === 'object' ? x.add : {};
        const pos = a.position && typeof a.position === 'object' ? a.position : {};
        return {
            ...d,
            ...x,
            id: typeof x.id === 'string' && x.id ? x.id : crypto.randomUUID(),
            name: typeof x.name === 'string' && x.name ? x.name : '未命名预设',
            enabled: x.enabled !== false,
            modelKeywords: Array.isArray(x.modelKeywords) ? x.modelKeywords.filter(v => typeof v === 'string' && v.trim()).map(v => v.trim()) : d.modelKeywords,
            modify: {
                ...d.modify,
                ...m,
                enabled: m.enabled !== false,
                match: m.match && typeof m.match === 'object' ? m.match : clone(d.modify.match),
                value: m.value !== undefined ? m.value : clone(d.modify.value),
                deletePaths: Array.isArray(m.deletePaths) ? m.deletePaths.filter(v => typeof v === 'string' && v.trim()) : [],
                maxMatches: Number.isFinite(Number(m.maxMatches)) ? Math.max(1, Number(m.maxMatches)) : 1,
            },
            add: {
                ...d.add,
                ...a,
                enabled: !!a.enabled,
                arrayPath: typeof a.arrayPath === 'string' ? a.arrayPath : d.add.arrayPath,
                value: a.value !== undefined ? a.value : clone(d.add.value),
                position: {
                    ...d.add.position,
                    ...pos,
                    type: typeof pos.type === 'string' ? pos.type : d.add.position.type,
                    index: Number.isFinite(Number(pos.index)) ? Math.max(1, Number(pos.index)) : 1,
                    relative: pos.relative === 'before' ? 'before' : 'after',
                    match: pos.match && typeof pos.match === 'object' ? pos.match : null,
                },
                maxAdds: Number.isFinite(Number(a.maxAdds)) ? Math.max(1, Number(a.maxAdds)) : 1,
            },
            notifications: {
                ...d.notifications,
                ...(x.notifications || {}),
            },
        };
    }

    function save() {
        if (!ctx) return;
        ctx.extensionSettings[EXT_KEY] = state;
        ctx.saveSettingsDebounced();
    }

    function activePreset() {
        return state.presets.find(p => p.id === state.activePresetId) || state.presets[0];
    }

    function modelMatches(model, keywords) {
        const m = String(model || '').toLowerCase();
        if (!m) return false;
        return keywords.some(k => m.includes(String(k).toLowerCase()));
    }

    function isPlainObject(v) {
        return v !== null && typeof v === 'object' && !Array.isArray(v);
    }

    function deepMatch(actual, pattern) {
        if (pattern === '*') return actual !== undefined;
        if (Array.isArray(pattern)) {
            if (!Array.isArray(actual) || actual.length !== pattern.length) return false;
            return pattern.every((p, i) => deepMatch(actual[i], p));
        }
        if (isPlainObject(pattern)) {
            if (!isPlainObject(actual)) return false;
            return Object.keys(pattern).every(k => k in actual && deepMatch(actual[k], pattern[k]));
        }
        return Object.is(actual, pattern);
    }

    function walkMatches(root, predicate, out = [], parent = null, key = null, path = []) {
        if (predicate(root)) out.push({ node: root, parent, key, path });
        if (Array.isArray(root)) {
            root.forEach((v, i) => walkMatches(v, predicate, out, root, i, [...path, i]));
        } else if (isPlainObject(root)) {
            Object.entries(root).forEach(([k, v]) => walkMatches(v, predicate, out, root, k, [...path, k]));
        }
        return out;
    }

    function getPath(root, path) {
        if (!path) return root;
        const parts = String(path).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
        let cur = root;
        for (const part of parts) {
            if (cur == null) return undefined;
            if (!(part in Object(cur))) return undefined;
            cur = cur[part];
        }
        return cur;
    }

    function mergeDeep(target, source) {
        if (!isPlainObject(target) || !isPlainObject(source)) return clone(source);
        const out = clone(target);
        for (const [k, v] of Object.entries(source)) {
            if (isPlainObject(v) && isPlainObject(out[k])) out[k] = mergeDeep(out[k], v);
            else out[k] = clone(v);
        }
        return out;
    }

    function deletePathsFromObject(target, paths) {
        if (!isPlainObject(target) && !Array.isArray(target)) return 0;
        let count = 0;
        for (const raw of paths) {
            const parts = String(raw).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
            if (!parts.length) continue;
            let cur = target;
            for (let i = 0; i < parts.length - 1; i++) {
                if (cur == null || !(parts[i] in Object(cur))) { cur = null; break; }
                cur = cur[parts[i]];
            }
            if (cur && Object.prototype.hasOwnProperty.call(cur, parts.at(-1))) {
                if (Array.isArray(cur)) cur.splice(Number(parts.at(-1)), 1);
                else delete cur[parts.at(-1)];
                count++;
            }
        }
        return count;
    }

    function replaceNode(ref, value) {
        if (!ref.parent) return clone(value);
        ref.parent[ref.key] = clone(value);
        return ref.parent[ref.key];
    }

    function modifyOne(root, ref, preset) {
        const m = preset.modify;
        if (m.mode === 'replace') replaceNode(ref, m.value);
        else {
            const merged = mergeDeep(ref.node, m.value);
            if (ref.parent) ref.parent[ref.key] = merged;
            else root = merged;
        }
        const target = ref.parent ? ref.parent[ref.key] : root;
        deletePathsFromObject(target, m.deletePaths);
        return root;
    }

    function chooseInsertIndex(arr, position) {
        switch (position.type) {
            case 'head': return 0;
            case 'headX': return Math.min(Math.max(position.index - 1, 0), arr.length);
            case 'end': return arr.length;
            case 'tailX': return Math.max(arr.length - (position.index - 1), 0);
            case 'index': return Math.min(Math.max(position.index - 1, 0), arr.length);
            default: return arr.length;
        }
    }

    function insertAddRule(data, preset) {
        const add = preset.add;
        const arr = getPath(data, add.arrayPath);
        if (!Array.isArray(arr)) return { added: 0, reason: `数组路径不存在：${add.arrayPath}` };
        let idx = chooseInsertIndex(arr, add.position);
        const pos = add.position;
        if (pos.type === 'matchAfter' || pos.type === 'matchBefore') {
            const hits = walkMatches(arr, node => pos.match && deepMatch(node, pos.match));
            if (!hits.length) return { added: 0, reason: '未找到插入定位结构' };
            const chosen = hits[0];
            idx = Number(chosen.path.at(-1));
            if (pos.type === 'matchAfter') idx += 1;
        }
        const count = Math.max(1, add.maxAdds || 1);
        for (let i = 0; i < count; i++) arr.splice(Math.min(idx + i, arr.length), 0, clone(add.value));
        return { added: count };
    }

    function applyPreset(data, preset) {
        let modified = 0;
        let added = 0;
        let result = data;
        let firstPath = '';
        let modifyReason = '';
        if (preset.modify.enabled) {
            const refs = walkMatches(result, node => deepMatch(node, preset.modify.match));
            if (refs.length) {
                const limit = Math.min(refs.length, preset.modify.maxMatches || 1);
                // 深度优先时先改更深位置，避免父节点改写后路径失效。
                const selected = refs.sort((a, b) => b.path.length - a.path.length).slice(0, limit);
                for (const ref of selected) {
                    result = modifyOne(result, ref, preset);
                    modified++;
                    if (!firstPath) firstPath = ref.path.map(String).join('.');
                }
            } else {
                modifyReason = '未找到篡改目标';
            }
        }
        if (preset.add.enabled) {
            const r = insertAddRule(result, preset);
            added += r.added;
            if (!r.added && r.reason && !modifyReason) modifyReason = r.reason;
        }
        return { data: result, modified, added, firstPath, reason: modifyReason };
    }

    function getModelFromPayload(data) {
        return data?.model || ctx?.chatCompletionSettings?.openai_model || ctx?.chatCompletionSettings?.custom_model || '';
    }

    function notifyResult(model, preset, result) {
        const detailed = state.settings.showDetailedToasts;
        if (result.modified || result.added) {
            const bits = [];
            if (result.modified) bits.push(`篡改 ${result.modified}`);
            if (result.added) bits.push(`新增 ${result.added}`);
            const extra = detailed ? ` · 预设：${preset.name}` : '';
            toastr.success(`JSON 篡改完成：${bits.join('，')}${extra}`, 'JSON 篡改器');
            return;
        }
        if (preset.notifications.noMatch) {
            const reason = result.reason || (preset.modify.enabled ? '未找到篡改目标' : '未执行任何规则');
            toastr.info(`JSON 篡改未发生：${reason}`, 'JSON 篡改器');
        }
    }

    function getFetchUrl(input) {
        if (typeof input === 'string') return input;
        if (input instanceof URL) return input.toString();
        if (input instanceof Request) return input.url;
        return '';
    }

    function isGenerationEndpoint(url) {
        try {
            const u = new URL(url, location.href);
            return u.pathname.endsWith('/api/backends/chat-completions/generate');
        } catch { return String(url).includes('/api/backends/chat-completions/generate'); }
    }

    function patchFetch() {
        if (installed) return;
        originalFetch = window.fetch.bind(window);
        window.fetch = async function(input, init = undefined) {
            try {
                if (state?.settings?.globalEnabled && state?.settings?.hookInternalGeneration && isGenerationEndpoint(getFetchUrl(input))) {
                    const opts = init ? { ...init } : {};
                    if (typeof opts.body === 'string') {
                        const data = JSON.parse(opts.body);
                        const preset = activePreset();
                        const model = getModelFromPayload(data);
                        if (preset?.enabled && modelMatches(model, preset.modelKeywords)) {
                            const result = applyPreset(data, preset);
                            opts.body = JSON.stringify(result.data);
                            notifyResult(model, preset, result);
                        }
                    }
                    return originalFetch(input, opts);
                }
            } catch (error) {
                if (state?.settings?.globalEnabled && state?.settings?.hookInternalGeneration && state?.settings?.errors !== false && activePreset()?.notifications?.errors !== false) {
                    toastr.error(`JSON 篡改失败：${error.message || error}`, 'JSON 篡改器');
                }
            }
            return originalFetch(input, init);
        };
        installed = true;
    }

    function buildUi() {
        if (uiBuilt) return;
        uiBuilt = true;
        const panel = document.createElement('div');
        panel.id = 'json-transformer-settings';
        panel.innerHTML = `
        <div class="inline-drawer">
          <div class="inline-drawer-toggle inline-drawer-header">
            <b>JSON 篡改器</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
          </div>
          <div class="inline-drawer-content">
            <div class="jtx-row"><label>启用<input id="jtx-enabled" type="checkbox"></label><label>详细弹窗<input id="jtx-detail" type="checkbox"></label></div>
            <div class="jtx-row"><label>预设<select id="jtx-preset"></select></label><button id="jtx-new">新建</button><button id="jtx-del">删除</button></div>
            <label>预设名称<input id="jtx-name" type="text"></label>
            <label>模型关键词（逗号分隔）<input id="jtx-keywords" type="text"></label>
            <div class="jtx-section"><b>篡改规则</b>
              <label>启用<input id="jtx-modify-enabled" type="checkbox"></label>
              <label>查找 JSON</label><textarea id="jtx-match" rows="7"></textarea>
              <label>方式<select id="jtx-mode"><option value="merge">合并字段</option><option value="replace">整个对象替换</option></select></label>
              <label>篡改 JSON</label><textarea id="jtx-value" rows="7"></textarea>
              <label>删除字段路径（每行一个，可空）</label><textarea id="jtx-delete" rows="3" placeholder="例如：reasoning_content"></textarea>
            </div>
            <div class="jtx-section"><b>新增规则</b>
              <label>启用<input id="jtx-add-enabled" type="checkbox"></label>
              <label>数组路径</label><input id="jtx-array-path" type="text" placeholder="例如 messages">
              <label>新增 JSON</label><textarea id="jtx-add-value" rows="7"></textarea>
              <label>插入方式<select id="jtx-position"><option value="head">头部第一条</option><option value="headX">头部第 X 条</option><option value="end">末尾</option><option value="tailX">倒数第 X 条</option><option value="index">第 X 条</option><option value="matchBefore">匹配结构前</option><option value="matchAfter">匹配结构后</option></select></label>
              <label id="jtx-index-wrap">X<input id="jtx-index" type="number" min="1" value="1"></label>
              <label id="jtx-position-match-wrap">定位 JSON</label><textarea id="jtx-position-match" rows="5" placeholder='例如 {"role":"user","content":"*"}'></textarea>
            </div>
            <div class="jtx-buttons"><button id="jtx-save" class="menu_button">保存当前预设</button><button id="jtx-test" class="menu_button">测试当前规则</button></div>
            <div class="jtx-hint">默认：Kimi K3 匹配已有 partial assistant，篡改 reasoning_content 为 &lt;thinking&gt;；新增规则默认关闭。</div>
          </div>
        </div>`;
        document.querySelector('#extensions_settings2, #extensions_settings')?.append(panel);
        const $ = id => panel.querySelector(id);

        function dump(v) { return JSON.stringify(v, null, 2); }
        function parseJsonField(id, fallback) { try { return JSON.parse($(id).value); } catch { throw new Error(`${id} 的 JSON 无效`); } }

        function fill() {
            const p = activePreset();
            $('#jtx-enabled').checked = state.settings.globalEnabled;
            $('#jtx-detail').checked = state.settings.showDetailedToasts;
            $('#jtx-name').value = p.name;
            $('#jtx-keywords').value = p.modelKeywords.join(', ');
            $('#jtx-modify-enabled').checked = p.modify.enabled;
            $('#jtx-match').value = dump(p.modify.match);
            $('#jtx-mode').value = p.modify.mode;
            $('#jtx-value').value = dump(p.modify.value);
            $('#jtx-delete').value = p.modify.deletePaths.join('\n');
            $('#jtx-add-enabled').checked = p.add.enabled;
            $('#jtx-array-path').value = p.add.arrayPath;
            $('#jtx-add-value').value = dump(p.add.value);
            $('#jtx-position').value = p.add.position.type;
            $('#jtx-index').value = p.add.position.index;
            $('#jtx-position-match').value = p.add.position.match ? dump(p.add.position.match) : '';
            updatePositionUi();
            $('#jtx-preset').innerHTML = state.presets.map(x => `<option value="${escapeHtml(x.id)}">${escapeHtml(x.name)}</option>`).join('');
            $('#jtx-preset').value = state.activePresetId;
        }

        function readIntoPreset() {
            const p = activePreset();
            p.name = $('#jtx-name').value.trim() || '未命名预设';
            p.modelKeywords = $('#jtx-keywords').value.split(',').map(x => x.trim()).filter(Boolean);
            p.modify.enabled = $('#jtx-modify-enabled').checked;
            p.modify.match = parseJsonField('#jtx-match', {});
            p.modify.mode = $('#jtx-mode').value;
            p.modify.value = parseJsonField('#jtx-value', {});
            p.modify.deletePaths = $('#jtx-delete').value.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
            p.add.enabled = $('#jtx-add-enabled').checked;
            p.add.arrayPath = $('#jtx-array-path').value.trim() || 'messages';
            p.add.value = parseJsonField('#jtx-add-value', {});
            p.add.position.type = $('#jtx-position').value;
            p.add.position.index = Math.max(1, Number($('#jtx-index').value || 1));
            const matchText = $('#jtx-position-match').value.trim();
            p.add.position.match = matchText ? parseJsonField('#jtx-position-match', null) : null;
        }

        function updatePositionUi() {
            const t = $('#jtx-position').value;
            $('#jtx-index-wrap').style.display = ['headX', 'tailX', 'index'].includes(t) ? '' : 'none';
            $('#jtx-position-match-wrap').style.display = ['matchBefore', 'matchAfter'].includes(t) ? '' : 'none';
        }

        function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

        $('#jtx-enabled').addEventListener('change', () => { state.settings.globalEnabled = $('#jtx-enabled').checked; save(); });
        $('#jtx-detail').addEventListener('change', () => { state.settings.showDetailedToasts = $('#jtx-detail').checked; save(); });
        $('#jtx-preset').addEventListener('change', () => { try { readIntoPreset(); } catch {} state.activePresetId = $('#jtx-preset').value; save(); fill(); });
        $('#jtx-position').addEventListener('change', updatePositionUi);
        $('#jtx-save').addEventListener('click', () => { try { readIntoPreset(); save(); fill(); toastr.success('当前预设已保存', 'JSON 篡改器'); } catch (e) { toastr.error(e.message, 'JSON 篡改器'); } });
        $('#jtx-new').addEventListener('click', () => {
            try { readIntoPreset(); } catch (e) { toastr.error(e.message, 'JSON 篡改器'); return; }
            const p = normalizePreset({ id: crypto.randomUUID(), name: '新预设', modelKeywords: [], modify: { enabled: true, match: {}, value: {} }, add: { enabled: false, value: {} } });
            state.presets.push(p); state.activePresetId = p.id; save(); fill();
        });
        $('#jtx-del').addEventListener('click', () => {
            if (state.presets.length <= 1) { toastr.warning('至少保留一个预设', 'JSON 篡改器'); return; }
            state.presets = state.presets.filter(p => p.id !== state.activePresetId);
            state.activePresetId = state.presets[0].id; save(); fill();
        });
        $('#jtx-test').addEventListener('click', () => {
            try {
                readIntoPreset();
                const sample = { messages: [{ role: 'user', content: 'test' }, { role: 'assistant', content: '', reasoning_content: 'sample', partial: true }], model: getModelFromPayload({}) || 'moonshotai/kimi-k3' };
                const r = applyPreset(sample, activePreset());
                toastr.info(`<pre style="max-height:50vh;overflow:auto;text-align:left;white-space:pre-wrap">${escapeHtml(JSON.stringify(r.data, null, 2))}</pre>`, `测试：篡改 ${r.modified} / 新增 ${r.added}`, { timeOut: 10000, extendedTimeOut: 10000 });
            } catch (e) { toastr.error(e.message, 'JSON 篡改器'); }
        });
        fill();
    }

    async function init() {
        ctx = SillyTavern.getContext();
        state = normalizeState(ctx.extensionSettings[EXT_KEY]);
        ctx.extensionSettings[EXT_KEY] = state;
        save();
        buildUi();
        patchFetch();
        console.info('[JSON Transformer] ready');
    }

    init().catch(err => toastr.error(`JSON 篡改器启动失败：${err.message || err}`, 'JSON 篡改器'));
})();

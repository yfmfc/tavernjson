(() => {
    'use strict';

    const EXT_KEY = 'json_transformer';
    const REQUEST_PATH = '/api/backends/chat-completions/generate';
    const DEFAULT_PRESET = {
        id: 'kimi-k3-default',
        name: 'Kimi K3 思维链预处理',
        enabled: true,
        modelKeywords: ['Kimi'],
        modify: {
            enabled: true,
            match: {
                role: 'assistant',
                content: '',
                reasoning_content: '先分析一下现在是什么情况。',
                partial: true,
            },
            mode: 'replace',
            value: {
                role: 'assistant',
                content: '',
                reasoning_content: '<thinking>',
                partial: true,
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

    const clone = (v) => {
        if (typeof structuredClone === 'function') return structuredClone(v);
        return JSON.parse(JSON.stringify(v));
    };

    function defaultState() {
        return {
            activePresetId: DEFAULT_PRESET.id,
            presets: [clone(DEFAULT_PRESET)],
            settings: {
                globalEnabled: true,
                showDetailedToasts: false,
                showUnmatchedModel: false,
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
                showUnmatchedModel: !!s.settings?.showUnmatchedModel,
            },
        };
        if (!normalized.presets.some(p => p.id === normalized.activePresetId)) {
            normalized.activePresetId = normalized.presets[0].id;
        }
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
            modelKeywords: Array.isArray(x.modelKeywords) ? x.modelKeywords.filter(v => typeof v === 'string' && v.trim()).map(v => v.trim()) : clone(d.modelKeywords),
            modify: {
                ...d.modify,
                ...m,
                enabled: m.enabled !== false,
                match: m.match && typeof m.match === 'object' ? clone(m.match) : clone(d.modify.match),
                mode: m.mode === 'merge' ? 'merge' : 'replace',
                value: m.value !== undefined ? clone(m.value) : clone(d.modify.value),
                deletePaths: Array.isArray(m.deletePaths) ? m.deletePaths.filter(v => typeof v === 'string' && v.trim()) : [],
                maxMatches: Number.isFinite(Number(m.maxMatches)) ? Math.max(1, Math.floor(Number(m.maxMatches))) : 1,
            },
            add: {
                ...d.add,
                ...a,
                enabled: !!a.enabled,
                arrayPath: typeof a.arrayPath === 'string' && a.arrayPath.trim() ? a.arrayPath.trim() : d.add.arrayPath,
                value: a.value !== undefined ? clone(a.value) : clone(d.add.value),
                position: {
                    ...d.add.position,
                    ...pos,
                    type: ['head', 'headX', 'end', 'tailX', 'index', 'matchBefore', 'matchAfter'].includes(pos.type) ? pos.type : d.add.position.type,
                    index: Number.isFinite(Number(pos.index)) ? Math.max(1, Math.floor(Number(pos.index))) : 1,
                    match: pos.match && typeof pos.match === 'object' ? clone(pos.match) : null,
                },
                maxAdds: Number.isFinite(Number(a.maxAdds)) ? Math.max(1, Math.floor(Number(a.maxAdds))) : 1,
            },
            notifications: {
                ...d.notifications,
                ...(x.notifications || {}),
            },
        };
    }

    function save() {
        if (!ctx || !state) return;
        ctx.extensionSettings[EXT_KEY] = state;
        ctx.saveSettingsDebounced();
    }

    function activePreset() {
        return state.presets.find(p => p.id === state.activePresetId) || state.presets[0];
    }

    function modelMatches(model, keywords) {
        const value = String(model || '').toLowerCase();
        return value && keywords.some(k => value.includes(String(k).toLowerCase()));
    }

    function isPlainObject(v) {
        return v !== null && typeof v === 'object' && !Array.isArray(v);
    }

    function deepMatch(actual, pattern) {
        if (pattern === '*') return actual !== undefined;
        if (Array.isArray(pattern)) {
            return Array.isArray(actual) && actual.length === pattern.length && pattern.every((p, i) => deepMatch(actual[i], p));
        }
        if (isPlainObject(pattern)) {
            return isPlainObject(actual) && Object.keys(pattern).every(k => Object.prototype.hasOwnProperty.call(actual, k) && deepMatch(actual[k], pattern[k]));
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
        const parts = String(path || '').replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
        let cur = root;
        for (const part of parts) {
            if (cur == null || !(part in Object(cur))) return undefined;
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
        if (!target || (typeof target !== 'object')) return 0;
        let count = 0;
        for (const raw of paths) {
            const parts = String(raw).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
            if (!parts.length) continue;
            let cur = target;
            for (let i = 0; i < parts.length - 1; i++) {
                if (cur == null || !(parts[i] in Object(cur))) { cur = null; break; }
                cur = cur[parts[i]];
            }
            const leaf = parts.at(-1);
            if (cur && Object.prototype.hasOwnProperty.call(cur, leaf)) {
                if (Array.isArray(cur)) cur.splice(Number(leaf), 1);
                else delete cur[leaf];
                count++;
            }
        }
        return count;
    }

    function modifyOne(data, ref, preset) {
        const m = preset.modify;
        if (!ref.parent) return clone(m.value);
        ref.parent[ref.key] = m.mode === 'replace' ? clone(m.value) : mergeDeep(ref.node, m.value);
        deletePathsFromObject(ref.parent[ref.key], m.deletePaths);
        return data;
    }

    function chooseInsertIndex(arr, position) {
        switch (position.type) {
            case 'head': return 0;
            case 'headX': return Math.min(Math.max(position.index - 1, 0), arr.length);
            case 'end': return arr.length;
            case 'tailX': return Math.max(arr.length - position.index + 1, 0);
            case 'index': return Math.min(Math.max(position.index - 1, 0), arr.length);
            default: return arr.length;
        }
    }

    function insertAddRule(data, preset) {
        const add = preset.add;
        const arr = getPath(data, add.arrayPath);
        if (!Array.isArray(arr)) return { added: 0, reason: `新增数组路径不存在：${add.arrayPath}` };

        let idx = chooseInsertIndex(arr, add.position);
        if (add.position.type === 'matchBefore' || add.position.type === 'matchAfter') {
            if (!add.position.match) return { added: 0, reason: '未设置插入定位 JSON' };
            const hits = walkMatches(arr, node => deepMatch(node, add.position.match));
            if (!hits.length) return { added: 0, reason: '未找到插入定位结构' };
            const p = hits[0].path.at(-1);
            idx = Number(p) + (add.position.type === 'matchAfter' ? 1 : 0);
        }

        const count = Math.max(1, add.maxAdds || 1);
        for (let i = 0; i < count; i++) arr.splice(Math.min(idx + i, arr.length), 0, clone(add.value));
        return { added: count, index: idx };
    }

    function applyPreset(data, preset) {
        let result = data;
        let modified = 0;
        let added = 0;
        let firstPath = '';
        const reasons = [];

        if (preset.modify.enabled) {
            const refs = walkMatches(result, node => deepMatch(node, preset.modify.match));
            if (!refs.length) {
                reasons.push('未找到篡改目标');
            } else {
                const selected = refs.sort((a, b) => b.path.length - a.path.length).slice(0, preset.modify.maxMatches || 1);
                for (const ref of selected) {
                    result = modifyOne(result, ref, preset);
                    modified++;
                    if (!firstPath) firstPath = ref.path.map(String).join('.');
                }
            }
        }

        if (preset.add.enabled) {
            const r = insertAddRule(result, preset);
            added += r.added;
            if (!r.added && r.reason) reasons.push(r.reason);
        }

        return { data: result, modified, added, firstPath, reasons };
    }

    function getModelFromPayload(data) {
        return data?.model || '';
    }

    function notifyResult(model, preset, result) {
        const detail = state.settings.showDetailedToasts;
        if (result.modified && result.added) {
            toastr.success(`✓ JSON 篡改完成：篡改 ${result.modified}，新增 ${result.added}${detail ? ` · ${preset.name}` : ''}`, 'JSON 篡改器');
            return;
        }
        if (result.modified) {
            toastr.success(`✓ JSON 篡改成功：${result.modified} 项${detail ? ` · ${preset.name}` : ''}`, 'JSON 篡改器');
            return;
        }
        if (result.added) {
            toastr.success(`✓ JSON 新增成功：${result.added} 项${detail ? ` · ${preset.name}` : ''}`, 'JSON 篡改器');
            return;
        }
        if (preset.notifications.noMatch) {
            toastr.info(`○ JSON 未找到目标：${result.reasons?.[0] || '未执行任何规则'}${detail ? ` · ${preset.name}` : ''}`, 'JSON 篡改器');
        }
    }

    function getUrl(input) {
        if (typeof input === 'string') return input;
        if (input instanceof URL) return input.toString();
        if (input instanceof Request) return input.url;
        return '';
    }

    function isGenerateEndpoint(url) {
        try {
            const u = new URL(url, location.href);
            return u.pathname === REQUEST_PATH || u.pathname.endsWith(REQUEST_PATH);
        } catch {
            return String(url).includes(REQUEST_PATH);
        }
    }

    async function readBody(input, init) {
        if (init && typeof init.body === 'string') return { body: init.body, source: 'init' };
        if (input instanceof Request) {
            try { return { body: await input.clone().text(), source: 'request' }; } catch { return null; }
        }
        return null;
    }

    async function patchFetch() {
        if (installed || typeof window.fetch !== 'function') return;
        originalFetch = window.fetch;
        window.fetch = async function(input, init = undefined) {
            const enabled = !!state?.settings?.globalEnabled;
            const url = getUrl(input);
            if (!enabled || !isGenerateEndpoint(url)) {
                return originalFetch.apply(this, arguments);
            }

            const preset = activePreset();
            if (!preset?.enabled) return originalFetch.apply(this, arguments);

            try {
                const bodyInfo = await readBody(input, init);
                if (!bodyInfo?.body) return originalFetch.apply(this, arguments);
                const data = JSON.parse(bodyInfo.body);
                const model = getModelFromPayload(data);

                if (!modelMatches(model, preset.modelKeywords)) {
                    if (state.settings.showUnmatchedModel) {
                        toastr.info(`○ JSON 未匹配模型：${model || '未知模型'}`, 'JSON 篡改器');
                    }
                    return originalFetch.apply(this, arguments);
                }

                const result = applyPreset(data, preset);

                if (bodyInfo.source === 'init') {
                    const nextInit = { ...(init || {}), body: JSON.stringify(result.data) };
                    notifyResult(model, preset, result);
                    return originalFetch.call(this, input, nextInit);
                }

                if (input instanceof Request) {
                    const nextRequest = new Request(input, { body: JSON.stringify(result.data) });
                    notifyResult(model, preset, result);
                    return originalFetch.call(this, nextRequest);
                }

                notifyResult(model, preset, result);
                return originalFetch.apply(this, arguments);
            } catch (error) {
                if (preset.notifications.errors) {
                    toastr.error(`✕ JSON 篡改失败：${error?.message || error}`, 'JSON 篡改器');
                }
                return originalFetch.apply(this, arguments);
            }
        };
        installed = true;
    }

    function dump(value) {
        return JSON.stringify(value, null, 2);
    }

    function escapeHtml(text) {
        return String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
            <div class="jtx-row"><label>总开关 <input id="jtx-enabled" type="checkbox"></label><label>详细弹窗 <input id="jtx-detail" type="checkbox"></label></div>
            <div class="jtx-row"><label>预设 <select id="jtx-preset"></select></label><button id="jtx-new" class="menu_button">新建</button><button id="jtx-del" class="menu_button">删除</button></div>
            <label>预设名称<input id="jtx-name" type="text"></label>
            <label>模型关键词（逗号分隔）<input id="jtx-keywords" type="text"></label>

            <details open class="jtx-section"><summary>篡改</summary>
              <label>启用 <input id="jtx-modify-enabled" type="checkbox"></label>
              <label>查找 JSON</label><textarea id="jtx-match" rows="7"></textarea>
              <label>篡改方式<select id="jtx-mode"><option value="replace">整个对象替换</option><option value="merge">合并字段</option></select></label>
              <label>篡改 JSON</label><textarea id="jtx-value" rows="7"></textarea>
              <label>删除字段路径（每行一个，可空）</label><textarea id="jtx-delete" rows="3" placeholder="例如：reasoning_content"></textarea>
              <label>最多篡改数量<input id="jtx-max-matches" type="number" min="1" value="1"></label>
            </details>

            <details class="jtx-section"><summary>插入</summary>
              <label>启用 <input id="jtx-add-enabled" type="checkbox"></label>
              <label>数组路径<input id="jtx-array-path" type="text" placeholder="例如 messages"></label>
              <label>新增 JSON</label><textarea id="jtx-add-value" rows="7"></textarea>
              <label>插入方式<select id="jtx-position">
                <option value="head">头部第一条</option><option value="headX">头部第 X 条</option><option value="end">末尾</option><option value="tailX">倒数第 X 条</option><option value="index">第 X 条</option><option value="matchBefore">匹配结构前</option><option value="matchAfter">匹配结构后</option>
              </select></label>
              <label id="jtx-index-wrap">X<input id="jtx-index" type="number" min="1" value="1"></label>
              <label id="jtx-position-match-wrap">定位 JSON</label><textarea id="jtx-position-match" rows="5" placeholder='例如 {"role":"user","content":"*"}'></textarea>
              <label>最多新增数量<input id="jtx-max-adds" type="number" min="1" value="1"></label>
            </details>

            <details class="jtx-section"><summary>高级 / 提示</summary>
              <label>未匹配模型也弹窗 <input id="jtx-unmatched-model" type="checkbox"></label>
              <div class="jtx-hint">请求层直接拦截 SillyTavern 的 /api/backends/chat-completions/generate；篡改后的 JSON 会交还给酒馆原本的发送流程，不由扩展自行发第二次请求。</div>
              <div class="jtx-hint">当前默认预设：模型关键词仅 Kimi；查找完整 assistant partial JSON；整个对象替换为 reasoning_content = &lt;thinking&gt;；插入默认关闭。</div>
            </details>

            <div class="jtx-buttons"><button id="jtx-save" class="menu_button">保存当前预设</button><button id="jtx-test" class="menu_button">测试当前规则</button></div>
          </div>
        </div>`;
        const host = document.querySelector('#extensions_settings2, #extensions_settings');
        host?.append(panel);
        const $ = id => panel.querySelector(id);

        function parseField(id) {
            try { return JSON.parse($(id).value); }
            catch { throw new Error(`${id} 的 JSON 无效`); }
        }

        function updatePositionUi() {
            const t = $('#jtx-position').value;
            $('#jtx-index-wrap').style.display = ['headX', 'tailX', 'index'].includes(t) ? '' : 'none';
            $('#jtx-position-match-wrap').style.display = ['matchBefore', 'matchAfter'].includes(t) ? '' : 'none';
        }

        function fill() {
            const p = activePreset();
            $('#jtx-enabled').checked = state.settings.globalEnabled;
            $('#jtx-detail').checked = state.settings.showDetailedToasts;
            $('#jtx-unmatched-model').checked = state.settings.showUnmatchedModel;
            $('#jtx-name').value = p.name;
            $('#jtx-keywords').value = p.modelKeywords.join(', ');
            $('#jtx-modify-enabled').checked = p.modify.enabled;
            $('#jtx-match').value = dump(p.modify.match);
            $('#jtx-mode').value = p.modify.mode;
            $('#jtx-value').value = dump(p.modify.value);
            $('#jtx-delete').value = p.modify.deletePaths.join('\n');
            $('#jtx-max-matches').value = p.modify.maxMatches;
            $('#jtx-add-enabled').checked = p.add.enabled;
            $('#jtx-array-path').value = p.add.arrayPath;
            $('#jtx-add-value').value = dump(p.add.value);
            $('#jtx-position').value = p.add.position.type;
            $('#jtx-index').value = p.add.position.index;
            $('#jtx-position-match').value = p.add.position.match ? dump(p.add.position.match) : '';
            $('#jtx-max-adds').value = p.add.maxAdds;
            updatePositionUi();
            $('#jtx-preset').innerHTML = state.presets.map(preset => `<option value="${escapeHtml(preset.id)}">${escapeHtml(preset.name)}</option>`).join('');
            $('#jtx-preset').value = state.activePresetId;
        }

        function readIntoPreset() {
            const p = activePreset();
            p.name = $('#jtx-name').value.trim() || '未命名预设';
            p.modelKeywords = $('#jtx-keywords').value.split(',').map(v => v.trim()).filter(Boolean);
            p.modify.enabled = $('#jtx-modify-enabled').checked;
            p.modify.match = parseField('#jtx-match');
            p.modify.mode = $('#jtx-mode').value === 'merge' ? 'merge' : 'replace';
            p.modify.value = parseField('#jtx-value');
            p.modify.deletePaths = $('#jtx-delete').value.split(/\r?\n/).map(v => v.trim()).filter(Boolean);
            p.modify.maxMatches = Math.max(1, Number($('#jtx-max-matches').value || 1));
            p.add.enabled = $('#jtx-add-enabled').checked;
            p.add.arrayPath = $('#jtx-array-path').value.trim() || 'messages';
            p.add.value = parseField('#jtx-add-value');
            p.add.position.type = $('#jtx-position').value;
            p.add.position.index = Math.max(1, Number($('#jtx-index').value || 1));
            p.add.position.match = $('#jtx-position-match').value.trim() ? parseField('#jtx-position-match') : null;
            p.add.maxAdds = Math.max(1, Number($('#jtx-max-adds').value || 1));
        }

        $('#jtx-enabled').addEventListener('change', () => { state.settings.globalEnabled = $('#jtx-enabled').checked; save(); });
        $('#jtx-detail').addEventListener('change', () => { state.settings.showDetailedToasts = $('#jtx-detail').checked; save(); });
        $('#jtx-unmatched-model').addEventListener('change', () => { state.settings.showUnmatchedModel = $('#jtx-unmatched-model').checked; save(); });
        $('#jtx-preset').addEventListener('change', () => {
            try { readIntoPreset(); } catch (e) { toastr.error(e.message, 'JSON 篡改器'); return; }
            state.activePresetId = $('#jtx-preset').value;
            save();
            fill();
        });
        $('#jtx-position').addEventListener('change', updatePositionUi);
        $('#jtx-save').addEventListener('click', () => {
            try { readIntoPreset(); save(); fill(); toastr.success('✓ 预设保存成功', 'JSON 篡改器'); }
            catch (e) { toastr.error(`保存失败：${e.message}`, 'JSON 篡改器'); }
        });
        $('#jtx-new').addEventListener('click', () => {
            try { readIntoPreset(); }
            catch (e) { toastr.error(e.message, 'JSON 篡改器'); return; }
            const p = normalizePreset({
                id: crypto.randomUUID(),
                name: '新预设',
                modelKeywords: [],
                modify: { enabled: true, match: {}, mode: 'replace', value: {} },
                add: { enabled: false, value: {} },
            });
            state.presets.push(p);
            state.activePresetId = p.id;
            save();
            fill();
        });
        $('#jtx-del').addEventListener('click', () => {
            if (state.presets.length <= 1) {
                toastr.warning('至少保留一个预设', 'JSON 篡改器');
                return;
            }
            state.presets = state.presets.filter(p => p.id !== state.activePresetId);
            state.activePresetId = state.presets[0].id;
            save();
            fill();
        });
        $('#jtx-test').addEventListener('click', () => {
            try {
                readIntoPreset();
                const sample = {
                    type: 'normal',
                    messages: [{ role: 'user', content: 'test' }, { role: 'assistant', content: '', reasoning_content: '先分析一下现在是什么情况。', partial: true }],
                    model: 'moonshotai/kimi-k3',
                };
                const r = applyPreset(sample, activePreset());
                const title = `测试：篡改 ${r.modified} / 新增 ${r.added}`;
                toastr.info(`<pre class="jtx-test-output">${escapeHtml(dump(r.data))}</pre>`, title, { timeOut: 12000, extendedTimeOut: 12000 });
            } catch (e) {
                toastr.error(`测试失败：${e.message}`, 'JSON 篡改器');
            }
        });

        fill();
    }

    async function init() {
        ctx = SillyTavern.getContext();
        state = normalizeState(ctx.extensionSettings[EXT_KEY]);
        ctx.extensionSettings[EXT_KEY] = state;
        save();
        buildUi();
        await patchFetch();
        console.info('[JSON 篡改器] 已启动：最终请求层拦截');
    }

    init().catch(error => toastr.error(`JSON 篡改器启动失败：${error?.message || error}`, 'JSON 篡改器'));
})();

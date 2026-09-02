const EXT_ID = 'xiaozhong-toolbox';
const STORAGE_KEY = `${EXT_ID}:settings`;

function getSettings() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}
function setSettings(v) { localStorage.setItem(STORAGE_KEY, JSON.stringify(v)); }

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function indentJson(value) {
    return JSON.stringify(value, null, 4) + '\n';
}

function reorderPresetPrompts(root) {
    if (!root || !Array.isArray(root.prompts) || !Array.isArray(root.prompt_order)) {
        throw new Error('不是可识别的 Preset：缺少 prompts 或 prompt_order。');
    }

    // Build the effective prompt id sequence exactly from prompt_order entries.
    // We do not change any prompt object or prompt_order data.
    const idSequence = [];
    for (const orderBlock of root.prompt_order) {
        if (!orderBlock || !Array.isArray(orderBlock.order)) continue;
        for (const item of orderBlock.order) {
            if (item && typeof item.identifier === 'string' && !idSequence.includes(item.identifier)) {
                idSequence.push(item.identifier);
            }
        }
    }

    const byId = new Map();
    for (const prompt of root.prompts) {
        if (prompt && typeof prompt.identifier === 'string') byId.set(prompt.identifier, prompt);
    }

    const result = [];
    const used = new Set();
    for (const id of idSequence) {
        const prompt = byId.get(id);
        if (prompt) {
            result.push(prompt);
            used.add(id);
        }
    }

    // Preserve any prompts not referenced by prompt_order at the end, in their original order.
    for (const prompt of root.prompts) {
        const id = prompt?.identifier;
        if (typeof id !== 'string' || !used.has(id)) result.push(prompt);
    }

    const output = structuredClone(root);
    output.prompts = result;
    return { output, total: root.prompts.length, reordered: result.filter((p, i) => p !== root.prompts[i]).length };
}

async function handlePresetFile(file) {
    const text = await file.text();
    let root;
    try { root = JSON.parse(text); } catch (e) { throw new Error('JSON 解析失败：文件不是有效 JSON。'); }
    const { output, total } = reorderPresetPrompts(root);
    const base = file.name.replace(/\.json$/i, '');
    downloadBlob(new Blob([indentJson(output)], { type: 'application/json;charset=utf-8' }), `${base}_整理后.json`);
    return `整理完成：${total} 个提示词条目。仅重新排列 prompts 数组中的对象，其他数据保持不变。`;
}

async function convertImage(file, format, quality = 0.92) {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const mime = format === 'png' ? 'image/png' : format === 'jpeg' ? 'image/jpeg' : 'image/webp';
    const blob = await new Promise(resolve => canvas.toBlob(resolve, mime, format === 'png' ? undefined : quality));
    if (!blob) throw new Error('图片转换失败。');
    const ext = format === 'jpeg' ? 'jpg' : format;
    downloadBlob(blob, `${file.name.replace(/\.[^.]+$/, '')}.${ext}`);
    return `${file.name} → ${ext.toUpperCase()}，${bitmap.width}×${bitmap.height}`;
}


async function fetchJson(url, body) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
    });
    if (!res.ok) throw new Error(`${url} 返回 ${res.status}`);
    return await res.json();
}

async function scanOrphanedEmbeddedWorlds() {
    const list = await fetchJson('/api/worldinfo/list', {});
    const contextModule = await import('/scripts/extensions.js');
    const context = contextModule.getContext();
    const characters = Array.isArray(context?.characters) ? context.characters : [];

    const liveLinkedWorlds = new Map();
    for (const character of characters) {
        const world = character?.data?.extensions?.world;
        if (typeof world === 'string' && world.trim()) {
            if (!liveLinkedWorlds.has(world)) liveLinkedWorlds.set(world, []);
            liveLinkedWorlds.get(world).push(character?.name || character?.avatar || '未知角色');
        }
    }

    const candidates = [];
    for (const item of Array.isArray(list) ? list : []) {
        const name = item?.name || item?.file_id;
        if (!name) continue;
        let data;
        try {
            data = await fetchJson('/api/worldinfo/get', { name });
        } catch (error) {
            console.warn('[小众工具箱] 读取世界书失败:', name, error);
            continue;
        }

        const original = data?.originalData;
        const looksLikeCharacterBook = Boolean(
            original &&
            typeof original === 'object' &&
            Array.isArray(original.entries)
        );

        // A Character Card imported Lorebook is stored with originalData equal to the
        // source character_book. A current character can independently link any world
        // by data.extensions.world, so we only flag the embedded-book cases that have
        // no current primary character link. This is a review candidate, never an
        // automatic deletion decision.
        if (looksLikeCharacterBook && !liveLinkedWorlds.has(name)) {
            candidates.push({
                name,
                entries: original.entries.length,
                sourceName: typeof original.name === 'string' ? original.name : '',
                reason: '检测到角色卡嵌入式 Character Book 的 originalData，当前没有角色主世界书链接',
            });
        }
    }
    return { candidates, total: Array.isArray(list) ? list.length : 0 };
}

function renderWorldCandidates(container, candidates) {
    container.innerHTML = '';
    if (!candidates.length) {
        container.textContent = '未发现可确认的遗留角色世界书。';
        return;
    }
    const fragment = document.createDocumentFragment();
    for (const c of candidates) {
        const row = document.createElement('label');
        row.className = 'xztb-check-row';
        row.innerHTML = `<input type="checkbox" data-world-name="${CSS.escape(c.name)}">` +
            `<span><b>${escapeHtml(c.name)}</b><small>${escapeHtml(c.reason)}；${c.entries} 个条目</small></span>`;
        fragment.appendChild(row);
    }
    container.appendChild(fragment);
}

function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
}

async function deleteSelectedWorlds(container, status) {
    const selected = [...container.querySelectorAll('input[data-world-name]:checked')]
        .map(x => x.dataset.worldName)
        .filter(Boolean);
    if (!selected.length) {
        status.textContent = '没有选择要清理的世界书。';
        return;
    }
    if (!confirm(`确定删除 ${selected.length} 个遗留世界书吗？此操作会直接删除 World Info 文件。`)) return;
    let deleted = 0;
    for (const name of selected) {
        try {
            const res = await fetch('/api/worldinfo/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });
            if (res.ok) deleted++;
        } catch (e) {
            console.error('[小众工具箱] 删除世界书失败:', name, e);
        }
    }
    status.textContent = `已删除 ${deleted} 个世界书。`;
    await runWorldScan(container, status);
}

async function runWorldScan(container, status) {
    status.textContent = '扫描中…';
    try {
        const { candidates, total } = await scanOrphanedEmbeddedWorlds();
        renderWorldCandidates(container, candidates);
        status.textContent = `已扫描 ${total} 个世界书，发现 ${candidates.length} 个候选。`;
    } catch (e) {
        console.error('[小众工具箱] 世界书扫描失败:', e);
        status.textContent = `扫描失败：${e?.message || e}`;
    }
}

function createUI() {
    if (document.getElementById(`${EXT_ID}-root`)) return;

    const root = document.createElement('div');
    root.id = `${EXT_ID}-root`;
    root.className = 'inline-drawer xztb-drawer';
    root.innerHTML = `
      <div class="inline-drawer-toggle inline-drawer-header xztb-header">
        <b>🧰 小众工具箱</b>
        <div class="inline-drawer-icon fa-fw fa-solid fa-circle-chevron-down"></div>
      </div>
      <div class="inline-drawer-content xztb-content">
        <div class="xztb-tool" data-tool="clean"><span>🧹 清理维护</span></div>
        <div class="xztb-tool" data-tool="install"><span>📦 扩展安装</span></div>
        <div class="xztb-tool" data-tool="image"><span>🖼️ 图片转换</span></div>
        <div class="xztb-tool" data-tool="preset"><span>📋 Preset 整理</span></div>
        <div class="xztb-tool" data-tool="personal"><span>🎨 个性化</span></div>
        <div class="xztb-panel" data-panel="clean">
          <div class="xztb-section-title">清理维护</div>
          <div class="xztb-group">
            <div class="xztb-subtitle">🌍 遗留角色世界书</div>
            <div class="xztb-note">仅提示“具有角色卡 Character Book 来源、但当前没有角色主世界书链接”的世界书，不把普通未绑定世界书当垃圾。</div>
            <div class="xztb-list" data-world-list></div>
            <div class="xztb-row">
              <button class="menu_button xztb-action" data-world-scan>扫描</button>
              <button class="menu_button xztb-action" data-world-delete>清理选中</button>
            </div>
            <div class="xztb-status" data-world-status></div>
          </div>
          <div class="xztb-group">
            <div class="xztb-subtitle">🗨️ 长期未使用聊天</div>
            <div class="xztb-note">聊天清理入口先保留；下一步接入 TauriTavern 的完整历史索引，而不是读取当前窗口的 chat 数组。</div>
          </div>
          <div class="xztb-group">
            <div class="xztb-subtitle">🗑️ 缓存 / 🧩 扩展残留</div>
            <div class="xztb-note">暂不猜测宿主目录。等公开 Host 能力明确后接入安全扫描。</div>
          </div>
        </div>
        <div class="xztb-panel" data-panel="install">
          <div class="xztb-section-title">扩展安装</div>
          <div class="xztb-note">ZIP 安装器作为下一阶段接入，遵循 TauriTavern 的归档安全检查规则。</div>
        </div>
        <div class="xztb-panel" data-panel="image">
          <div class="xztb-section-title">图片转换</div>
          <input class="text_pole" type="file" accept="image/*" data-image-file>
          <div class="xztb-row">
            <select class="text_pole" data-image-format>
              <option value="png">PNG</option>
              <option value="jpeg">JPEG</option>
              <option value="webp">WEBP</option>
            </select>
            <button class="menu_button xztb-action" data-image-convert>转换并保存</button>
          </div>
          <div class="xztb-status" data-image-status></div>
        </div>
        <div class="xztb-panel" data-panel="preset">
          <div class="xztb-section-title">Preset JSON 整理</div>
          <div class="xztb-note">只按照 Preset 内置 prompt_order 对 prompts[] 重新排列；不修改任何条目数据或排序数据。</div>
          <input class="text_pole" type="file" accept="application/json,.json" data-preset-file>
          <button class="menu_button xztb-action" data-preset-sort>整理并导出</button>
          <div class="xztb-status" data-preset-status></div>
        </div>
        <div class="xztb-panel" data-panel="personal">
          <div class="xztb-section-title">个性化</div>
          <label>工具箱显示名称</label>
          <input class="text_pole" data-person-name placeholder="小众工具箱">
          <label>工具箱入口图标（Emoji）</label>
          <input class="text_pole" data-person-icon placeholder="🧰">
          <button class="menu_button xztb-action" data-person-save>保存</button>
          <div class="xztb-status" data-person-status></div>
        </div>
      </div>`;

    // Prefer TauriTavern's extensions area; fall back to the native drawer if needed.
    const target = document.querySelector('#extensions_settings2, #extensions_settings') || document.body;
    target.appendChild(root);

    const settings = getSettings();
    root.querySelector('[data-person-name]').value = settings.name || '小众工具箱';
    root.querySelector('[data-person-icon]').value = settings.icon || '🧰';
    root.querySelector('.xztb-header b').textContent = `${settings.icon || '🧰'} ${settings.name || '小众工具箱'}`;

    root.querySelectorAll('.xztb-tool').forEach(tool => {
        tool.addEventListener('click', () => {
            const name = tool.dataset.tool;
            root.querySelectorAll('.xztb-tool').forEach(t => t.classList.toggle('xztb-active', t === tool));
            root.querySelectorAll('.xztb-panel').forEach(p => p.classList.toggle('xztb-hidden', p.dataset.panel !== name));
        });
    });

    const worldList = root.querySelector('[data-world-list]');
    const worldStatus = root.querySelector('[data-world-status]');
    root.querySelector('[data-world-scan]').addEventListener('click', () => runWorldScan(worldList, worldStatus));
    root.querySelector('[data-world-delete]').addEventListener('click', () => deleteSelectedWorlds(worldList, worldStatus));

    root.querySelector('[data-image-convert]').addEventListener('click', async () => {
        const file = root.querySelector('[data-image-file]').files?.[0];
        const format = root.querySelector('[data-image-format]').value;
        const status = root.querySelector('[data-image-status]');
        if (!file) { status.textContent = '请选择图片。'; return; }
        status.textContent = '正在转换…';
        try { status.textContent = await convertImage(file, format); }
        catch (e) { status.textContent = e?.message || '转换失败。'; console.error(e); }
    });

    root.querySelector('[data-preset-sort]').addEventListener('click', async () => {
        const file = root.querySelector('[data-preset-file]').files?.[0];
        const status = root.querySelector('[data-preset-status]');
        if (!file) { status.textContent = '请选择 Preset JSON。'; return; }
        status.textContent = '正在整理…';
        try { status.textContent = await handlePresetFile(file); }
        catch (e) { status.textContent = e?.message || '整理失败。'; console.error(e); }
    });

    root.querySelector('[data-person-save]').addEventListener('click', () => {
        const name = root.querySelector('[data-person-name]').value.trim() || '小众工具箱';
        const icon = root.querySelector('[data-person-icon]').value.trim() || '🧰';
        setSettings({ name, icon });
        root.querySelector('.xztb-header b').textContent = `${icon} ${name}`;
        root.querySelector('[data-person-status]').textContent = '已保存。';
    });
}

export function init() {
    createUI();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', createUI, { once: true });
else createUI();

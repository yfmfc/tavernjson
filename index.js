const EXT_ID = 'xiaozhong-toolbox';

function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
}

function getDownloadFilename(name, suffix = '_整理后') {
    return `${String(name || '文件').replace(/[\\/:*?"<>|]+/g, '_').replace(/\.[^.]+$/, '')}${suffix}`;
}

function triggerBlobDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.className = 'menu_button';
    link.textContent = `保存 ${filename}`;
    link.style.display = 'inline-block';
    link.dataset.xztbDownload = '1';
    return { url, link };
}

function clearOldDownload(container) {
    container.querySelectorAll('[data-xztb-download="1"]').forEach(el => el.remove());
}

function indentJson(value) {
    return JSON.stringify(value, null, 4) + '\n';
}

function reorderPresetPrompts(root) {
    if (!root || !Array.isArray(root.prompts) || !Array.isArray(root.prompt_order)) {
        throw new Error('不是可识别的 Preset：缺少 prompts 或 prompt_order。');
    }

    const idSequence = [];
    const seenIds = new Set();
    for (const orderBlock of root.prompt_order) {
        if (!orderBlock || !Array.isArray(orderBlock.order)) continue;
        for (const item of orderBlock.order) {
            const id = item?.identifier;
            if (typeof id === 'string' && !seenIds.has(id)) {
                seenIds.add(id);
                idSequence.push(id);
            }
        }
    }

    const byId = new Map();
    for (const prompt of root.prompts) {
        if (prompt && typeof prompt.identifier === 'string' && !byId.has(prompt.identifier)) {
            byId.set(prompt.identifier, prompt);
        }
    }

    const result = [];
    const usedObjects = new Set();
    for (const id of idSequence) {
        const prompt = byId.get(id);
        if (prompt) {
            result.push(prompt);
            usedObjects.add(prompt);
        }
    }

    // Entries not referenced by prompt_order are never discarded; retain their
    // original relative position at the end.
    for (const prompt of root.prompts) {
        if (!usedObjects.has(prompt)) result.push(prompt);
    }

    const output = structuredClone(root);
    output.prompts = result;
    return { output, total: root.prompts.length, referenced: idSequence.length };
}

async function handlePresetFile(file, statusContainer) {
    const text = await file.text();
    let root;
    try {
        root = JSON.parse(text);
    } catch {
        throw new Error('JSON 解析失败：文件不是有效 JSON。');
    }

    const { output, total, referenced } = reorderPresetPrompts(root);
    clearOldDownload(statusContainer);
    const filename = `${getDownloadFilename(file.name)}.json`;
    const blob = new Blob([indentJson(output)], { type: 'application/json;charset=utf-8' });
    const { link } = triggerBlobDownload(blob, filename);
    statusContainer.appendChild(link);
    return { message: `整理完成：${total} 个条目；按 prompt_order 排列 ${referenced} 个；其他条目保留在末尾。`, filename };
}

async function convertImage(file, format, statusContainer) {
    if (!file.type.startsWith('image/')) throw new Error('请选择图片文件。');

    const bitmap = await createImageBitmap(file);
    try {
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d', { alpha: true });
        if (!ctx) throw new Error('当前环境无法创建图片画布。');

        // JPEG has no alpha channel; use white background so transparent images
        // do not become black when converted to JPEG.
        if (format === 'jpeg') {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx.drawImage(bitmap, 0, 0);

        const mime = format === 'png' ? 'image/png' : format === 'jpeg' ? 'image/jpeg' : 'image/webp';
        const blob = await new Promise(resolve =>
            canvas.toBlob(resolve, mime, format === 'png' ? undefined : 0.92),
        );
        if (!blob) throw new Error('图片转换失败。');

        clearOldDownload(statusContainer);
        const ext = format === 'jpeg' ? 'jpg' : format;
        const filename = `${String(file.name).replace(/\.[^.]+$/, '')}.${ext}`;
        const { link } = triggerBlobDownload(blob, filename);
        statusContainer.appendChild(link);
        return { message: `转换完成：${file.name} → ${ext.toUpperCase()}（${bitmap.width}×${bitmap.height}，${Math.round(blob.size / 1024)} KB）`, filename };
    } finally {
        bitmap.close?.();
    }
}

async function getStRequestHeaders() {
    // SillyTavern 1.18's request helper is still part of the frontend used by
    // TauriTavern. It adds the headers expected by the retained API endpoints.
    try {
        const script = await import('/script.js');
        if (typeof script.getRequestHeaders === 'function') {
            return script.getRequestHeaders();
        }
    } catch (e) {
        console.warn('[小众工具箱] 无法从 /script.js 获取请求头:', e);
    }
    return { 'Content-Type': 'application/json' };
}

async function stPostJson(url, body) {
    const headers = await getStRequestHeaders();
    if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body ?? {}),
    });
    if (!response.ok) throw new Error(`${url} 返回 HTTP ${response.status}`);
    return response.json();
}

async function getCharacters() {
    try {
        const contextModule = await import('/scripts/extensions.js');
        const context = contextModule.getContext?.();
        if (Array.isArray(context?.characters)) return context.characters;
    } catch (e) {
        console.warn('[小众工具箱] 获取角色列表失败:', e);
    }

    // Fallback to the global used by the upstream 1.18 frontend.
    if (Array.isArray(globalThis.characters)) return globalThis.characters;
    return [];
}

async function listWorldNames() {
    const data = await stPostJson('/api/settings/get', {});
    if (Array.isArray(data?.world_names)) return data.world_names;
    if (Array.isArray(data)) return data;
    throw new Error('无法读取 TauriTavern 的世界书列表。');
}

async function getWorld(name) {
    return stPostJson('/api/worldinfo/get', { name });
}

async function scanOrphanedEmbeddedWorlds() {
    const names = await listWorldNames();
    const characters = await getCharacters();

    const liveLinkedWorlds = new Map();
    for (const character of characters) {
        const world = character?.data?.extensions?.world;
        if (typeof world === 'string' && world.trim()) {
            const normalized = world.trim();
            if (!liveLinkedWorlds.has(normalized)) liveLinkedWorlds.set(normalized, []);
            liveLinkedWorlds.get(normalized).push(character?.name || character?.avatar || '未知角色');
        }
    }

    const candidates = [];
    let inspected = 0;
    for (const rawName of names) {
        const name = typeof rawName === 'string' ? rawName : rawName?.name || rawName?.file_id;
        if (!name) continue;
        inspected++;
        let data;
        try {
            data = await getWorld(name);
        } catch (error) {
            console.warn('[小众工具箱] 读取世界书失败:', name, error);
            continue;
        }

        const original = data?.originalData;
        const looksLikeEmbeddedCharacterBook = Boolean(
            original &&
            typeof original === 'object' &&
            Array.isArray(original.entries),
        );

        if (looksLikeEmbeddedCharacterBook && !liveLinkedWorlds.has(name)) {
            candidates.push({
                name,
                entries: original.entries.length,
                sourceName: typeof original.name === 'string' ? original.name : '',
                linkedCharacters: liveLinkedWorlds.get(name) || [],
            });
        }
    }

    return { candidates, total: inspected };
}

function renderWorldCandidates(container, candidates) {
    container.innerHTML = '';
    if (!candidates.length) {
        container.textContent = '未发现符合条件的遗留角色世界书。';
        return;
    }

    const fragment = document.createDocumentFragment();
    for (const candidate of candidates) {
        const row = document.createElement('label');
        row.className = 'xztb-check-row';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = candidate.name;
        input.dataset.worldName = candidate.name;

        const text = document.createElement('span');
        const title = document.createElement('b');
        title.textContent = candidate.name;
        const detail = document.createElement('small');
        detail.textContent = `检测到角色卡 Character Book 数据；当前未发现角色绑定；${candidate.entries} 个条目`;
        text.append(title, detail);
        row.append(input, text);
        fragment.appendChild(row);
    }
    container.appendChild(fragment);
}

async function deleteSelectedWorlds(container, status) {
    const selected = [...container.querySelectorAll('input[data-world-name]:checked')]
        .map(input => input.value)
        .filter(Boolean);

    if (!selected.length) {
        status.textContent = '没有选择要清理的世界书。';
        return;
    }

    if (!confirm(`确定删除 ${selected.length} 个世界书吗？删除后不能通过本工具撤销。`)) return;

    let deleted = 0;
    const failed = [];
    for (const name of selected) {
        try {
            await stPostJson('/api/worldinfo/delete', { name });
            deleted++;
        } catch (error) {
            failed.push(`${name}: ${error?.message || error}`);
        }
    }

    status.textContent = failed.length
        ? `已删除 ${deleted} 个；失败 ${failed.length} 个。`
        : `已删除 ${deleted} 个世界书。`;
    await runWorldScan(container, status);
}

async function runWorldScan(container, status) {
    status.textContent = '扫描中…';
    try {
        const { candidates, total } = await scanOrphanedEmbeddedWorlds();
        renderWorldCandidates(container, candidates);
        status.textContent = `已扫描 ${total} 个世界书，发现 ${candidates.length} 个候选。`;
    } catch (error) {
        console.error('[小众工具箱] 世界书扫描失败:', error);
        status.textContent = `扫描失败：${error?.message || error}`;
    }
}

async function inspectZip(file, status) {
    const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    const isZip = header.length === 4 && header[0] === 0x50 && header[1] === 0x4b &&
        (header[2] === 0x03 || header[2] === 0x05 || header[2] === 0x07) &&
        (header[3] === 0x04 || header[3] === 0x06 || header[3] === 0x08);
    if (!isZip) throw new Error('这个文件不是有效的 ZIP 文件。');

    status.textContent = `已读取本机文件：${file.name}（${Math.round(file.size / 1024)} KB）。`;
    status.insertAdjacentHTML('beforeend', '<br>当前 TauriTavern 公共 Host 接口没有“本地 ZIP → 扩展目录”的安装方法，因此本版本不会伪装成已安装。');
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
            <div class="xztb-tools">
                <button class="menu_button xztb-tool" type="button" data-tool="clean">🧹 清理维护</button>
                <button class="menu_button xztb-tool" type="button" data-tool="install">📦 扩展导入</button>
                <button class="menu_button xztb-tool" type="button" data-tool="image">🖼️ 图片转换</button>
                <button class="menu_button xztb-tool" type="button" data-tool="preset">📋 Preset 整理</button>
            </div>

            <div class="xztb-panel" data-panel="clean">
                <div class="xztb-group">
                    <div class="xztb-subtitle">🌍 遗留角色世界书</div>
                    <div class="xztb-note">只检查角色卡嵌入式 Character Book 形成的世界书；普通全局/独立世界书不会因为“没有角色绑定”而被当成垃圾。</div>
                    <div class="xztb-list" data-world-list></div>
                    <div class="xztb-row">
                        <button class="menu_button" type="button" data-world-scan>扫描</button>
                        <button class="menu_button" type="button" data-world-select-all>全选</button>
                        <button class="menu_button" type="button" data-world-delete>清理选中</button>
                    </div>
                    <div class="xztb-status" data-world-status></div>
                </div>

                <div class="xztb-group">
                    <div class="xztb-subtitle">🗨️ 长期未使用聊天</div>
                    <div class="xztb-note">15 天阈值和完整聊天索引将在接入 TauriTavern 对应 Host 能力后启用；本版本不读取当前窗口的局部 chat 数组。</div>
                </div>

                <div class="xztb-group">
                    <div class="xztb-subtitle">🗑️ 缓存</div>
                    <div class="xztb-note">仅接入宿主明确允许清理的缓存；不会根据猜测路径直接删除文件。</div>
                </div>

                <div class="xztb-group">
                    <div class="xztb-subtitle">🧩 已删除扩展数据</div>
                    <div class="xztb-note">等 TauriTavern 的扩展数据存储/所有权接口确认后扫描；不会误删未知目录。</div>
                </div>
            </div>

            <div class="xztb-panel xztb-hidden" data-panel="install">
                <div class="xztb-group">
                    <div class="xztb-subtitle">📦 从本机选择 ZIP</div>
                    <input class="xztb-file-input" id="xztb-zip-file" type="file" accept=".zip,application/zip,application/x-zip-compressed" data-zip-file>
                    <label class="menu_button xztb-file-button" for="xztb-zip-file">📂 选择本机 ZIP 文件</label>
                    <div class="xztb-note" data-zip-selected>尚未选择文件。文件来自手机/电脑本机“文件”选择器。</div>
                    <div class="xztb-row"><button class="menu_button" type="button" data-zip-install disabled>确认导入 / 安装</button></div><div class="xztb-status" data-zip-status></div>
                </div>
            </div>

            <div class="xztb-panel xztb-hidden" data-panel="image">
                <div class="xztb-group">
                    <div class="xztb-subtitle">🖼️ 图片格式转换</div>
                    <input class="xztb-file-input" id="xztb-image-file" type="file" accept="image/*" data-image-file>
                    <label class="menu_button xztb-file-button" for="xztb-image-file">📂 选择本机图片</label>
                    <div class="xztb-note" data-image-selected>尚未选择图片。</div>
                    <div class="xztb-row">
                        <select class="text_pole" data-image-format>
                            <option value="png">PNG</option>
                            <option value="jpeg">JPEG</option>
                            <option value="webp">WEBP</option>
                        </select>
                        <button class="menu_button" type="button" data-image-convert>转换</button>
                    </div>
                    <div class="xztb-status" data-image-status></div>
                </div>
            </div>

            <div class="xztb-panel xztb-hidden" data-panel="preset">
                <div class="xztb-group">
                    <div class="xztb-subtitle">📋 Preset JSON 整理</div>
                    <div class="xztb-note">只读取 JSON 内已有的 prompt_order 作为排列依据，重新排列 prompts[] 对象；不改动任何对象内容、ID 或 prompt_order。</div>
                    <input class="xztb-file-input" id="xztb-preset-file" type="file" accept="application/json,.json" data-preset-file>
                    <label class="menu_button xztb-file-button" for="xztb-preset-file">📂 选择本机 Preset JSON</label>
                    <div class="xztb-note" data-preset-selected>尚未选择 JSON 文件。</div>
                    <button class="menu_button" type="button" data-preset-sort>📋 开始整理</button>
                    <div class="xztb-status" data-preset-status></div>
                </div>
            </div>
        </div>`;

    const target = document.querySelector('#extensions_settings2, #extensions_settings');
    if (!target) {
        console.warn('[小众工具箱] 未找到 TauriTavern 扩展区域，稍后重试。');
        setTimeout(createUI, 500);
        return;
    }
    target.appendChild(root);

    const showTool = (name) => {
        root.querySelectorAll('.xztb-tool').forEach(tool => {
            tool.classList.toggle('xztb-active', tool.dataset.tool === name);
        });
        root.querySelectorAll('.xztb-panel').forEach(panel => {
            panel.classList.toggle('xztb-hidden', panel.dataset.panel !== name);
        });
    };

    root.querySelectorAll('.xztb-tool').forEach(tool => tool.addEventListener('click', () => showTool(tool.dataset.tool)));
    showTool('clean');

    const worldList = root.querySelector('[data-world-list]');
    const worldStatus = root.querySelector('[data-world-status]');
    root.querySelector('[data-world-scan]').addEventListener('click', () => runWorldScan(worldList, worldStatus));
    root.querySelector('[data-world-select-all]').addEventListener('click', () => {
        worldList.querySelectorAll('input[data-world-name]').forEach(input => { input.checked = true; });
    });
    root.querySelector('[data-world-delete]').addEventListener('click', () => deleteSelectedWorlds(worldList, worldStatus));

    root.querySelector('[data-zip-file]').addEventListener('change', async (event) => {
        const file = event.target.files?.[0];
        const status = root.querySelector('[data-zip-status]');
        const selected = root.querySelector('[data-zip-selected]');
        if (!file) return;
        selected.textContent = `已选择：${file.name}（${Math.round(file.size / 1024)} KB）`;
        try { await inspectZip(file, status); root.querySelector('[data-zip-install]').disabled = false; }
        catch (e) { status.textContent = `ZIP 检查失败：${e?.message || e}`; }
    });

    root.querySelector('[data-zip-install]').addEventListener('click', async () => {
        const file = root.querySelector('[data-zip-file]').files?.[0];
        const status = root.querySelector('[data-zip-status]');
        if (!file) { status.textContent = '请先选择 ZIP 文件。'; return; }
        if (!confirm(`确认导入/安装扩展：${file.name}？`)) return;
        status.textContent = '正在尝试安装…';
        try {
            const host = globalThis.__TAURITAVERN__;
            const api = host?.api || host;
            const installer = api?.extensions?.installZip || api?.extensions?.installFromZip || api?.installExtensionZip;
            if (typeof installer !== 'function') {
                throw new Error('当前 TauriTavern 未公开本机 ZIP 安装接口。ZIP 已验证，但不能安全写入扩展目录。');
            }
            await installer(file);
            status.textContent = '安装完成，请刷新扩展列表确认。';
        } catch (e) { status.textContent = `导入失败：${e?.message || e}`; }
    });

    root.querySelector('[data-image-file]').addEventListener('change', (event) => {
        const file = event.target.files?.[0];
        if (file) root.querySelector('[data-image-selected]').textContent = `已选择：${file.name}`;
    });

    root.querySelector('[data-image-convert]').addEventListener('click', async () => {
        const file = root.querySelector('[data-image-file]').files?.[0];
        const format = root.querySelector('[data-image-format]').value;
        const status = root.querySelector('[data-image-status]');
        if (!file) { status.textContent = '请选择图片。'; return; }
        status.textContent = '正在转换…';
        try {
            const result = await convertImage(file, format, status);
            const link = status.querySelector('[data-xztb-download]');
            status.insertAdjacentText('afterbegin', `${result.message} `);
            if (link) { link.textContent = `⬇️ 导出 / 保存 ${result.filename}`; }
        }
        catch (e) { status.textContent = `转换失败：${e?.message || e}`; console.error('[小众工具箱]', e); }
    });

    root.querySelector('[data-preset-file]').addEventListener('change', (event) => {
        const file = event.target.files?.[0];
        if (file) root.querySelector('[data-preset-selected]').textContent = `已选择：${file.name}`;
    });

    root.querySelector('[data-preset-sort]').addEventListener('click', async () => {
        const file = root.querySelector('[data-preset-file]').files?.[0];
        const status = root.querySelector('[data-preset-status]');
        if (!file) { status.textContent = '请选择 Preset JSON。'; return; }
        status.textContent = '正在整理…';
        try {
            const result = await handlePresetFile(file, status);
            const link = status.querySelector('[data-xztb-download]');
            status.insertAdjacentText('afterbegin', `${result.message} `);
            if (link) { link.textContent = `⬇️ 导出 / 保存 ${result.filename}`; }
        }
        catch (e) { status.textContent = `整理失败：${e?.message || e}`; console.error('[小众工具箱]', e); }
    });
}

async function init() {
    try {
        const host = globalThis.__TAURITAVERN__;
        const ready = host?.ready || globalThis.__TAURITAVERN_MAIN_READY__;
        if (ready && typeof ready.then === 'function') await ready;
    } catch (e) {
        console.warn('[小众工具箱] TauriTavern Host 就绪等待失败，继续尝试挂载:', e);
    }
    createUI();
}

init();

export { init, reorderPresetPrompts };

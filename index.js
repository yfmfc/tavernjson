const EXT_ID = 'xiaozhong-toolbox';

function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
}

function getOutputStem(name, suffix = '') {
    const base = String(name || '文件').replace(/[\\/:*?"<>|]+/g, '_').replace(/\.[^.]+$/, '');
    return `${base}${suffix}`;
}

function createBlobSaveLink(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.className = 'menu_button';
    link.textContent = `⬇️ 保存 ${filename}`;
    link.style.display = 'inline-block';
    link.dataset.xztbDownload = '1';
    link.addEventListener('click', () => setTimeout(() => URL.revokeObjectURL(url), 60000), { once: true });
    return { link, url };
}

function clearOldDownloads(container) {
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
        if (prompt && typeof prompt.identifier === 'string' && !byId.has(prompt.identifier)) byId.set(prompt.identifier, prompt);
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
    for (const prompt of root.prompts) if (!usedObjects.has(prompt)) result.push(prompt);
    const output = structuredClone(root);
    output.prompts = result;
    return {
        output,
        total: root.prompts.length,
        referenced: idSequence.filter(id => byId.has(id)).length,
        unreferenced: root.prompts.length - idSequence.filter(id => byId.has(id)).length,
    };
}

async function handlePresetFile(file, statusContainer) {
    clearOldDownloads(statusContainer);
    const text = await file.text();
    let root;
    try { root = JSON.parse(text); } catch { throw new Error('JSON 解析失败：文件不是有效 JSON。'); }
    const { output, total, referenced, unreferenced } = reorderPresetPrompts(root);
    const filename = `${getOutputStem(file.name, '_整理后')}.json`;
    const blob = new Blob([indentJson(output)], { type: 'application/json;charset=utf-8' });
    const { link } = createBlobSaveLink(blob, filename);
    const result = document.createElement('div');
    result.className = 'xztb-result';
    result.textContent = `整理完成：共 ${total} 个条目，按 prompt_order 排列 ${referenced} 个，未出现在排序中的 ${unreferenced} 个保留在末尾。`;
    statusContainer.append(result, link);
}

async function canvasToCompressedPng(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('无法读取图片像素。');
    // Prefer native browser PNG encoding when it already keeps a reasonable size.
    // The indexed-PNG path below is used only when needed.
    const native = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (native && native.size <= Math.max(1024 * 1024, canvas.width * canvas.height * 0.5)) return native;
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { data, width, height } = image;
    const bins = 1 << 15;
    const counts = new Uint32Array(bins);
    const sumsR = new Uint32Array(bins);
    const sumsG = new Uint32Array(bins);
    const sumsB = new Uint32Array(bins);
    const sumsA = new Uint32Array(bins);
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
        const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
        counts[key]++; sumsR[key] += r; sumsG[key] += g; sumsB[key] += b; sumsA[key] += a;
    }
    const occupied = [];
    for (let key = 0; key < bins; key++) if (counts[key]) occupied.push(key);
    occupied.sort((a, b) => counts[b] - counts[a]);
    const paletteKeys = occupied.slice(0, Math.min(256, occupied.length));
    const palette = new Uint8Array(paletteKeys.length * 4);
    for (let i = 0; i < paletteKeys.length; i++) {
        const key = paletteKeys[i], c = counts[key];
        palette[i * 4] = Math.round(sumsR[key] / c);
        palette[i * 4 + 1] = Math.round(sumsG[key] / c);
        palette[i * 4 + 2] = Math.round(sumsB[key] / c);
        palette[i * 4 + 3] = Math.round(sumsA[key] / c);
    }
    const binToPalette = new Uint8Array(bins);
    for (let key = 0; key < bins; key++) {
        const r = ((key >> 10) & 31) * 8 + 4, g = ((key >> 5) & 31) * 8 + 4, b = (key & 31) * 8 + 4;
        let best = 0, bestDistance = Infinity;
        for (let p = 0; p < paletteKeys.length; p++) {
            const pr = palette[p * 4], pg = palette[p * 4 + 1], pb = palette[p * 4 + 2];
            const dr = r - pr, dg = g - pg, db = b - pb;
            const distance = dr * dr + dg * dg + db * db;
            if (distance < bestDistance) { bestDistance = distance; best = p; }
        }
        binToPalette[key] = best;
    }
    const raw = new Uint8Array(height * (width + 1));
    let out = 0;
    for (let y = 0; y < height; y++) {
        raw[out++] = 0;
        const row = y * width * 4;
        for (let x = 0; x < width; x++) {
            const p = row + x * 4;
            const key = ((data[p] >> 3) << 10) | ((data[p + 1] >> 3) << 5) | (data[p + 2] >> 3);
            raw[out++] = binToPalette[key];
        }
    }
    if (!globalThis.CompressionStream) return native || new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const compressed = await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer();
    const pngSignature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const makeChunk = (type, payload) => {
        const typeBytes = new TextEncoder().encode(type);
        const buffer = new Uint8Array(12 + payload.length);
        const view = new DataView(buffer.buffer);
        view.setUint32(0, payload.length); buffer.set(typeBytes, 4); buffer.set(payload, 8);
        view.setUint32(buffer.length - 4, crc32Concat(typeBytes, payload));
        return buffer;
    };
    const ihdr = new ArrayBuffer(13), ihdrView = new DataView(ihdr);
    ihdrView.setUint32(0, width); ihdrView.setUint32(4, height); ihdrView.setUint8(8, 8); ihdrView.setUint8(9, 3);
    const plte = new Uint8Array(paletteKeys.length * 3), trns = new Uint8Array(paletteKeys.length);
    let hasAlpha = false;
    for (let i = 0; i < paletteKeys.length; i++) {
        plte[i * 3] = palette[i * 4]; plte[i * 3 + 1] = palette[i * 4 + 1]; plte[i * 3 + 2] = palette[i * 4 + 2];
        trns[i] = palette[i * 4 + 3]; if (trns[i] !== 255) hasAlpha = true;
    }
    const parts = [pngSignature, makeChunk('IHDR', new Uint8Array(ihdr)), makeChunk('PLTE', plte)];
    if (hasAlpha) parts.push(makeChunk('tRNS', trns));
    parts.push(makeChunk('IDAT', new Uint8Array(compressed)), makeChunk('IEND', new Uint8Array()));
    const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
    const result = new Uint8Array(totalLength); let offset = 0;
    for (const part of parts) { result.set(part, offset); offset += part.length; }
    return new Blob([result], { type: 'image/png' });
}

let crcTable = null;
function crc32(bytes) {
    if (!crcTable) {
        crcTable = new Uint32Array(256);
        for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); crcTable[n] = c >>> 0; }
    }
    let c = 0xffffffff; for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0;
}
function crc32Concat(a, b) { const joined = new Uint8Array(a.length + b.length); joined.set(a); joined.set(b, a.length); return crc32(joined); }

async function convertImage(file, format, statusContainer) {
    if (!file.type.startsWith('image/')) throw new Error('请选择图片文件。');
    clearOldDownloads(statusContainer);
    if (format === 'png' && file.type === 'image/png') {
        const { link } = createBlobSaveLink(file, file.name);
        const result = document.createElement('div'); result.className = 'xztb-result';
        result.textContent = `图片已经是 PNG，无需重新编码（${Math.round(file.size / 1024)} KB）。`;
        statusContainer.append(result, link); return;
    }
    const bitmap = await createImageBitmap(file);
    try {
        const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: format === 'png' });
        if (!ctx) throw new Error('当前环境无法创建图片画布。');
        if (format === 'jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
        ctx.drawImage(bitmap, 0, 0);
        const mime = format === 'png' ? 'image/png' : format === 'jpeg' ? 'image/jpeg' : 'image/webp';
        const blob = format === 'png' ? await canvasToCompressedPng(canvas) : await new Promise(resolve => canvas.toBlob(resolve, mime, 0.88));
        if (!blob) throw new Error('图片转换失败。');
        const ext = format === 'jpeg' ? 'jpg' : format, filename = `${getOutputStem(file.name)}.${ext}`;
        const { link } = createBlobSaveLink(blob, filename);
        const result = document.createElement('div'); result.className = 'xztb-result';
        const ratio = file.size ? (blob.size / file.size).toFixed(2) : '-';
        result.textContent = `转换完成：${file.name} → ${ext.toUpperCase()}（${bitmap.width}×${bitmap.height}，${Math.round(blob.size / 1024)} KB；原文件 ${Math.round(file.size / 1024)} KB）。`;
        if (ratio !== '-') result.textContent += ` 体积倍率 ${ratio}×。`;
        statusContainer.append(result, link);
    } finally { bitmap.close?.(); }
}

async function getStRequestHeaders() {
    try { const script = await import('/script.js'); if (typeof script.getRequestHeaders === 'function') return script.getRequestHeaders(); }
    catch (e) { console.warn('[小众工具箱] 无法获取请求头:', e); }
    return { 'Content-Type': 'application/json' };
}
async function stFetch(url, options = {}) {
    const headers = new Headers(options.headers || await getStRequestHeaders());
    return fetch(url, { ...options, headers });
}
async function stPostJson(url, body) {
    const response = await stFetch(url, { method: 'POST', body: JSON.stringify(body ?? {}) });
    if (!response.ok) throw new Error(`${url} 返回 HTTP ${response.status}`);
    return response.json();
}
async function getCharacters() {
    const response = await stFetch('/api/characters/all', { method: 'POST', body: JSON.stringify({}) });
    if (!response.ok) throw new Error(`获取角色列表失败：HTTP ${response.status}`);
    const data = await response.json();
    return Array.isArray(data) ? data : Object.values(data || {});
}

function normalizeWorldId(value) {
    return String(value ?? '').trim().replace(/\.json$/i, '');
}
function getWorldBindingNames(character) {
    const world = character?.data?.extensions?.world;
    return typeof world === 'string' && world.trim() ? normalizeWorldId(world) : '';
}
function loadWorldProvenance() {
    try {
        const raw = localStorage.getItem('xiaozhong_toolbox_world_provenance_v1');
        const parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch { return {}; }
}
function saveWorldProvenance(provenance) {
    try { localStorage.setItem('xiaozhong_toolbox_world_provenance_v1', JSON.stringify(provenance)); } catch (error) { console.warn('[小众工具箱] 无法保存世界书来源记录:', error); }
}
function updateWorldProvenance(characters, worlds) {
    const provenance = loadWorldProvenance();
    const byName = new Map();
    for (const item of worlds) {
        const fileId = normalizeWorldId(item?.file_id ?? item?.name);
        const display = normalizeWorldId(item?.name);
        if (fileId) { byName.set(fileId, fileId); if (display) byName.set(display, fileId); }
    }
    for (const character of characters) {
        const worldName = getWorldBindingNames(character);
        const book = character?.data?.character_book;
        if (!worldName || !book) continue;
        const worldId = byName.get(worldName) || worldName;
        provenance[worldId] = {
            worldId,
            sourceCharacter: String(character?.name || '未知角色'),
            sourceAvatar: String(character?.avatar || ''),
            recordedAt: Date.now(),
        };
    }
    saveWorldProvenance(provenance);
    return provenance;
}
async function listWorlds() {
    const data = await stPostJson('/api/worldinfo/list', {});
    if (!Array.isArray(data)) throw new Error('世界书列表返回格式异常。');
    return data;
}
async function getWorld(fileId) { return stPostJson('/api/worldinfo/get', { name: normalizeWorldId(fileId) }); }

function extractWorldData(payload) {
    if (!payload || typeof payload !== 'object') return null;
    if (payload.data && typeof payload.data === 'object' && (payload.data.entries || payload.data.originalData)) return payload.data;
    if (payload.world && typeof payload.world === 'object' && (payload.world.entries || payload.world.originalData)) return payload.world;
    return payload;
}
function getOriginalCharacterBook(data) {
    const candidates = [data?.originalData, data?.data?.originalData, data?.extensions?.originalData];
    for (const original of candidates) {
        if (original && typeof original === 'object') {
            const entries = original.entries;
            if (Array.isArray(entries) || (entries && typeof entries === 'object')) return original;
        }
    }
    return null;
}

async function scanEmbeddedWorlds(livePrimaryLinks, characters, progress) {
    const worlds = await listWorlds();
    const provenance = updateWorldProvenance(characters, worlds);
    const candidates = [], errors = [];
    const liveLinks = new Set([...livePrimaryLinks.keys()].map(normalizeWorldId));
    for (let i = 0; i < worlds.length; i++) {
        const item = worlds[i] || {};
        const fileId = normalizeWorldId(item.file_id ?? item.name);
        const displayName = String(item.name || fileId);
        if (!fileId) continue;
        progress?.(`扫描世界书 ${i + 1}/${worlds.length}…`);
        try {
            const data = extractWorldData(await getWorld(fileId));
            const original = getOriginalCharacterBook(data);
            const recorded = provenance[fileId];
            const live = liveLinks.has(fileId) || liveLinks.has(normalizeWorldId(displayName));
            // Two independent provenance signals are accepted:
            // 1) the World Info still contains the imported Character Book's originalData;
            // 2) our local provenance ledger recorded that this world was created/used as a character-card book.
            // The ledger is only written when a live character has both character_book and a primary world binding,
            // so it does not classify an ordinary manually-created global world as an orphan.
            if (!original && !recorded) continue;
            if (live) continue;
            const entries = original?.entries
                ? (Array.isArray(original.entries) ? original.entries.length : Object.keys(original.entries || {}).length)
                : Array.isArray(data?.entries) ? data.entries.length : Object.keys(data?.entries || {}).length;
            candidates.push({
                worldId: fileId,
                fileId,
                name: displayName,
                entries,
                sourceName: original?.name || '',
                sourceCharacter: recorded?.sourceCharacter || '',
                provenance: original ? 'Character Book originalData' : '历史角色绑定记录',
            });
        } catch (error) { errors.push({ fileId, error }); }
    }
    return { total: worlds.length, candidates, errors };
}
async function scanOldChats(days, characters, progress) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const candidates = [], errors = [];
    for (let i = 0; i < characters.length; i++) {
        const character = characters[i] || {}, avatar = character.avatar;
        if (!avatar) continue;
        progress?.(`扫描聊天 ${i + 1}/${characters.length}…`);
        try {
            const response = await stFetch('/api/characters/chats', { method: 'POST', body: JSON.stringify({ avatar_url: avatar }) });
            if (!response.ok) { errors.push({ character, error: new Error(`HTTP ${response.status}`) }); continue; }
            const data = await response.json(); if (!data || data.error === true) continue;
            for (const chat of Object.values(data)) {
                if (!chat || !chat.file_name) continue;
                const time = parseChatTimestamp(chat.last_mes ?? chat.date_last_chat ?? chat.last_message);
                if (!Number.isFinite(time) || time >= cutoff) continue;
                const fileName = String(chat.file_name).replace(/\.jsonl$/i, '');
                const current = character.chat && String(character.chat) === fileName;
                candidates.push({ characterName: character.name || '未知角色', avatar, fileName, chatId: fileName, time, current });
            }
        } catch (error) { errors.push({ character, error }); }
    }
    candidates.sort((a, b) => a.time - b.time);
    return { candidates, errors };
}
function parseChatTimestamp(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
    if (typeof value !== 'string') return NaN;
    const trimmed = value.trim(); if (!trimmed) return NaN;
    if (/^\d+$/.test(trimmed)) { const n = Number(trimmed); return n < 1e12 ? n * 1000 : n; }
    const parsed = Date.parse(trimmed); return Number.isFinite(parsed) ? parsed : NaN;
}
function formatDate(timestamp) { return new Date(timestamp).toLocaleString(); }

async function scanWebCaches() {
    if (!('caches' in globalThis)) return { supported: false, caches: [] };
    const names = await caches.keys(); const result = [];
    for (const name of names) {
        let entries = [];
        try { entries = await (await caches.open(name)).keys(); } catch { /* leave count unknown */ }
        result.push({ name, cacheId: name, entries: entries.length });
    }
    return { supported: true, caches: result };
}

async function discoverHostCleanup() {
    const api = globalThis.__TAURITAVERN__?.api;
    return {
        cacheScan: typeof api?.cache?.scan === 'function',
        cacheClear: typeof api?.cache?.clearSafe === 'function' || typeof api?.cache?.clear === 'function',
        tempScan: typeof api?.files?.scanTemp === 'function' || typeof api?.files?.listTemp === 'function',
        tempClear: typeof api?.files?.clearTemp === 'function' || typeof api?.files?.cleanupTemp === 'function',
    };
}

async function clearSelectedWorlds(selected) {
    let deleted = 0;
    for (const item of selected) {
        const response = await stFetch('/api/worldinfo/delete', { method: 'POST', body: JSON.stringify({ name: item }) });
        if (response.ok) deleted++;
    }
    return deleted;
}
async function clearSelectedChats(selected) {
    let deleted = 0;
    for (const item of selected) {
        const response = await stFetch('/api/chats/delete', { method: 'POST', body: JSON.stringify({ chatfile: `${item.fileName}.jsonl`, avatar_url: item.avatar }) });
        if (response.ok) deleted++;
    }
    return deleted;
}

function renderCleanResults(root, state) {
    const box = root.querySelector('[data-clean-results]');
    box.innerHTML = '';
    const summary = document.createElement('div'); summary.className = 'xztb-summary';
    summary.textContent = `扫描完成：${state.worldCandidates.length} 个遗留角色世界书、${state.chatCandidates.length} 个长期未使用聊天、${state.webCaches.length} 个网页缓存。`;
    box.appendChild(summary);

    const renderGroup = (title, count, rows, key, detailFn, disabledFn = () => false) => {
        const details = document.createElement('details'); details.open = count > 0; details.className = 'xztb-clean-group';
        const summaryEl = document.createElement('summary'); summaryEl.textContent = `${title}（${count}）`; details.appendChild(summaryEl);
        if (!count) { const empty = document.createElement('div'); empty.className = 'xztb-note'; empty.textContent = '没有发现可清理项目。'; details.appendChild(empty); box.appendChild(details); return; }
        const list = document.createElement('div'); list.className = 'xztb-list';
        for (const rowData of rows) {
            const label = document.createElement('label'); label.className = 'xztb-check-row';
            const input = document.createElement('input'); input.type = 'checkbox'; input.disabled = disabledFn(rowData); input.dataset[key] = '1';
            input.value = rowData[key] ?? rowData.name ?? rowData.fileId ?? rowData.fileName ?? '';
            const text = document.createElement('span'); const titleEl = document.createElement('b'); titleEl.textContent = rowData.name || rowData.fileName || rowData.characterName;
            const small = document.createElement('small'); small.textContent = detailFn(rowData); text.append(titleEl, small); label.append(input, text); list.appendChild(label);
        }
        details.appendChild(list); const actions = document.createElement('div'); actions.className = 'xztb-row';
        const all = document.createElement('button'); all.type = 'button'; all.className = 'menu_button'; all.textContent = '全选'; all.addEventListener('click', () => list.querySelectorAll('input:not(:disabled)').forEach(x => x.checked = true));
        const clear = document.createElement('button'); clear.type = 'button'; clear.className = 'menu_button'; clear.textContent = '清理选中';
        clear.dataset.cleanAction = key; actions.append(all, clear); details.appendChild(actions); box.appendChild(details);
    };

    renderGroup('🌍 角色卡遗留世界书', state.worldCandidates.length, state.worldCandidates, 'worldId', r => `${r.provenance}${r.sourceCharacter ? `；原角色：${r.sourceCharacter}` : ''}${r.sourceName ? `；书名：${r.sourceName}` : ''}；${r.entries} 个条目；当前没有角色绑定此书`);
    renderGroup('🗨️ 超过设定天数未使用的聊天', state.chatCandidates.length, state.chatCandidates, 'chatId', r => `${formatDate(r.time)}${r.current ? '；当前聊天，不允许删除' : ''}`, r => r.current);
    renderGroup('🌐 网页 Cache Storage', state.webCaches.length, state.webCaches, 'cacheId', r => `${r.entries} 个缓存请求；删除后网页资源可能需要重新缓存`);

    const host = document.createElement('details'); host.className = 'xztb-clean-group';
    const hs = document.createElement('summary'); hs.textContent = '🧹 TauriTavern 宿主缓存 / 临时文件'; host.appendChild(hs);
    const hnote = document.createElement('div'); hnote.className = 'xztb-note';
    const caps = state.host;
    hnote.textContent = (caps.cacheScan || caps.tempScan) ? '检测到宿主清理能力，后续可接入真实扫描结果。' : '当前版本没有公开可安全调用的宿主临时文件/HTTP 缓存清理 API，因此不猜目录、不直接删除。';
    host.appendChild(hnote); box.appendChild(host);

    if (state.errors.length) {
        const error = document.createElement('div'); error.className = 'xztb-note'; error.textContent = `有 ${state.errors.length} 项读取失败，未列入清理。`;
        box.appendChild(error);
    }
}

async function scanAllCleanup(root) {
    const status = root.querySelector('[data-clean-status]');
    status.textContent = '正在扫描…';
    root.querySelector('[data-clean-results]').innerHTML = '';
    const state = { worldCandidates: [], chatCandidates: [], webCaches: [], host: {}, errors: [] };
    try {
        const characters = await getCharacters();
        const livePrimaryLinks = new Map();
        for (const character of characters) {
            const world = getWorldBindingNames(character);
            if (world) livePrimaryLinks.set(world, true);
        }
        const [worldResult, chatResult, webResult, host] = await Promise.all([
            scanEmbeddedWorlds(livePrimaryLinks, characters, s => status.textContent = s),
            scanOldChats(Number(root.querySelector('[data-chat-days]').value) || 15, characters, s => status.textContent = s),
            scanWebCaches(),
            discoverHostCleanup(),
        ]);
        state.worldCandidates = worldResult.candidates;
        state.chatCandidates = chatResult.candidates;
        state.webCaches = webResult.caches;
        state.host = host;
        state.errors = [...worldResult.errors, ...chatResult.errors];
        root.__xztbCleanState = state;
        renderCleanResults(root, state);
        status.textContent = `扫描完成：世界书 ${worldResult.candidates.length}，旧聊天 ${chatResult.candidates.length}，网页缓存 ${webResult.caches.length}。`;
    } catch (error) {
        console.error('[小众工具箱] 清理扫描失败:', error);
        status.textContent = `扫描失败：${error?.message || error}`;
    }
}

async function handleCleanAction(root, key) {
    const list = root.querySelectorAll(`input[data-${key}]:checked`);
    if (!list.length) return;
    if (!confirm('确定删除选中的数据吗？此操作会直接调用 TauriTavern 的删除接口。')) return;
    try {
        if (key === 'worldId') {
            const ids = [...list].map(x => x.value); const deleted = await clearSelectedWorlds(ids);
            root.querySelector('[data-clean-status]').textContent = `已删除 ${deleted} 个世界书。`;
        } else if (key === 'chatId') {
            const items = [...list].map(x => { const row = root.__xztbCleanState.chatCandidates.find(r => r.fileName === x.value); return row; }).filter(Boolean);
            const deleted = await clearSelectedChats(items);
            root.querySelector('[data-clean-status]').textContent = `已删除 ${deleted} 个聊天。`;
        } else if (key === 'cacheId') {
            let deleted = 0; for (const name of [...list].map(x => x.value)) if (await caches.delete(name)) deleted++;
            root.querySelector('[data-clean-status]').textContent = `已删除 ${deleted} 个网页缓存。`;
        }
        await scanAllCleanup(root);
    } catch (error) { root.querySelector('[data-clean-status]').textContent = `清理失败：${error?.message || error}`; }
}

async function inspectZip(file, status, actions) {
    const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    const isZip = header.length === 4 && header[0] === 0x50 && header[1] === 0x4b && (header[2] === 0x03 || header[2] === 0x05 || header[2] === 0x07) && (header[3] === 0x04 || header[3] === 0x06 || header[3] === 0x08);
    if (!isZip) throw new Error('这个文件不是有效的 ZIP 文件。');
    status.textContent = `已选择：${file.name}（${Math.round(file.size / 1024)} KB）`;
    actions.innerHTML = '';
    const confirmButton = document.createElement('button'); confirmButton.type = 'button'; confirmButton.className = 'menu_button'; confirmButton.textContent = '确认导入 / 安装';
    confirmButton.addEventListener('click', () => installZipViaHost(file, status)); actions.appendChild(confirmButton);
}
async function installZipViaHost(file, status) {
    const api = globalThis.__TAURITAVERN__?.api;
    const candidates = [api?.extensions?.installZip, api?.extensions?.installFromZip, api?.installExtensionZip].filter(fn => typeof fn === 'function');
    if (!candidates.length) { status.textContent = '当前 TauriTavern 公开 Host API 没有本机 ZIP 安装接口。文件选择与确认已完成，但不会伪装成已安装。'; return; }
    try { await candidates[0].call(api.extensions || api, { file }); status.textContent = '扩展安装请求已发送。'; }
    catch (error) { status.textContent = `安装失败：${error?.message || error}`; }
}

function createUI() {
    if (document.getElementById(`${EXT_ID}-root`)) return;
    const root = document.createElement('div'); root.id = `${EXT_ID}-root`; root.className = 'inline-drawer xztb-drawer';
    root.innerHTML = `
        <div class="inline-drawer-toggle inline-drawer-header xztb-header"><b>🧰 小众工具箱</b><div class="inline-drawer-icon fa-fw fa-solid fa-circle-chevron-down"></div></div>
        <div class="inline-drawer-content xztb-content">
            <div class="xztb-tools">
                <button class="menu_button xztb-tool" type="button" data-tool="clean">🧹 清理维护</button>
                <button class="menu_button xztb-tool" type="button" data-tool="install">📦 扩展导入</button>
                <button class="menu_button xztb-tool" type="button" data-tool="image">🖼️ 图片转换</button>
                <button class="menu_button xztb-tool" type="button" data-tool="preset">📋 Preset 整理</button>
            </div>
            <div class="xztb-panel" data-panel="clean">
                <div class="xztb-group"><div class="xztb-row"><label class="xztb-inline-label">聊天闲置超过 <input class="text_pole xztb-days" type="number" min="1" value="15" data-chat-days> 天</label><button class="menu_button" type="button" data-clean-scan>🔍 一键扫描全部</button></div><div class="xztb-status" data-clean-status></div><div class="xztb-list" data-clean-results></div></div>
            </div>
            <div class="xztb-panel xztb-hidden" data-panel="install"><div class="xztb-group"><div class="xztb-subtitle">📦 从本机选择 ZIP</div><input class="text_pole" type="file" accept=".zip,application/zip,application/x-zip-compressed" data-zip-file><div class="xztb-note">文件来自手机/电脑本机文件选择器。</div><div class="xztb-status" data-zip-status></div><div class="xztb-row" data-zip-actions></div></div></div>
            <div class="xztb-panel xztb-hidden" data-panel="image"><div class="xztb-group"><div class="xztb-subtitle">🖼️ 图片格式转换</div><input class="text_pole" type="file" accept="image/*" data-image-file><div class="xztb-row"><select class="text_pole" data-image-format><option value="png">PNG</option><option value="jpeg">JPEG</option><option value="webp">WEBP</option></select><button class="menu_button" type="button" data-image-convert>转换</button></div><div class="xztb-status" data-image-status></div></div></div>
            <div class="xztb-panel xztb-hidden" data-panel="preset"><div class="xztb-group"><div class="xztb-subtitle">📋 Preset JSON 整理</div><div class="xztb-note">只按照 JSON 内已有的 prompt_order 重排 prompts[]；不修改条目内容、ID、prompt_order 或其他数据。</div><input class="text_pole" type="file" accept="application/json,.json" data-preset-file><button class="menu_button" type="button" data-preset-sort>整理并生成文件</button><div class="xztb-status" data-preset-status></div></div></div>
        </div>`;
    const target = document.querySelector('#extensions_settings2, #extensions_settings'); if (!target) { setTimeout(createUI, 500); return; } target.appendChild(root);
    const showTool = name => { root.querySelectorAll('.xztb-tool').forEach(t => t.classList.toggle('xztb-active', t.dataset.tool === name)); root.querySelectorAll('.xztb-panel').forEach(p => p.classList.toggle('xztb-hidden', p.dataset.panel !== name)); };
    root.querySelectorAll('.xztb-tool').forEach(t => t.addEventListener('click', () => showTool(t.dataset.tool))); showTool('clean');
    root.querySelector('[data-clean-scan]').addEventListener('click', () => scanAllCleanup(root));
    root.querySelector('[data-clean-results]').addEventListener('click', event => { const button = event.target.closest('[data-clean-action]'); if (button) handleCleanAction(root, button.dataset.cleanAction); });
    root.querySelector('[data-zip-file]').addEventListener('change', async event => { const file = event.target.files?.[0]; if (!file) return; try { await inspectZip(file, root.querySelector('[data-zip-status]'), root.querySelector('[data-zip-actions]')); } catch (e) { root.querySelector('[data-zip-status]').textContent = `ZIP 检查失败：${e?.message || e}`; } });
    root.querySelector('[data-image-convert]').addEventListener('click', async () => { const file = root.querySelector('[data-image-file]').files?.[0], format = root.querySelector('[data-image-format]').value, status = root.querySelector('[data-image-status]'); if (!file) { status.textContent = '请先选择本机图片。'; return; } status.textContent = format === 'png' ? '正在转换并压缩 PNG…' : '正在转换…'; try { await convertImage(file, format, status); } catch (e) { status.textContent = `转换失败：${e?.message || e}`; console.error('[小众工具箱]', e); } });
    root.querySelector('[data-preset-sort]').addEventListener('click', async () => { const file = root.querySelector('[data-preset-file]').files?.[0], status = root.querySelector('[data-preset-status]'); if (!file) { status.textContent = '请先选择本机 Preset JSON。'; return; } status.textContent = '正在整理…'; try { await handlePresetFile(file, status); } catch (e) { status.textContent = `整理失败：${e?.message || e}`; console.error('[小众工具箱]', e); } });
}
async function init() { try { const host = globalThis.__TAURITAVERN__, ready = host?.ready || globalThis.__TAURITAVERN_MAIN_READY__; if (ready && typeof ready.then === 'function') await ready; } catch (e) { console.warn('[小众工具箱] Host ready 等待失败:', e); } createUI(); }
init();
export { init, reorderPresetPrompts };

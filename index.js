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
    try {
        localStorage.setItem('xiaozhong_toolbox_world_provenance_v1', JSON.stringify(provenance));
    } catch (error) {
        console.warn('[小众工具箱] 无法保存世界书来源记录:', error);
    }
}
function normalizeWorldId(value) {
    return String(value ?? '').trim().replace(/\.json$/i, '');
}
function getWorldBindingNames(character) {
    const world = character?.data?.extensions?.world;
    return typeof world === 'string' && world.trim() ? normalizeWorldId(world) : '';
}
function getAuxWorldBindingsFromSettings(settings) {
    const result = [];
    const charLore = settings?.world_info?.charLore ?? settings?.charLore ?? [];
    if (!Array.isArray(charLore)) return result;
    for (const row of charLore) {
        if (!row || !Array.isArray(row.extraBooks)) continue;
        for (const book of row.extraBooks) {
            const world = normalizeWorldId(book);
            if (world) result.push(world);
        }
    }
    return result;
}
function getGlobalWorldBindingsFromSettings(settings) {
    const selected = settings?.world_info?.globalSelect ?? settings?.globalSelect ?? [];
    return Array.isArray(selected) ? selected.map(normalizeWorldId).filter(Boolean) : [];
}
function getPersonaWorldBindingFromSettings(settings) {
    const candidates = [
        settings?.world_info?.persona_description_lorebook,
        settings?.persona_description_lorebook,
        settings?.power_user?.persona_description_lorebook,
    ];
    for (const value of candidates) {
        const normalized = normalizeWorldId(value);
        if (normalized) return normalized;
    }
    return '';
}
function getCurrentChatWorldBinding() {
    try {
        const ctx = globalThis.SillyTavern?.getContext?.() || globalThis.getContext?.();
        const meta = ctx?.chatMetadata;
        const world = meta?.world_info ?? meta?.worldInfo ?? meta?.world;
        return normalizeWorldId(world);
    } catch {
        return '';
    }
}
function updateWorldProvenance(characters, worlds, settings) {
    const provenance = loadWorldProvenance();
    const byName = new Map();
    for (const item of worlds) {
        const fileId = normalizeWorldId(item?.file_id ?? item?.name);
        const display = normalizeWorldId(item?.name);
        if (fileId) {
            byName.set(fileId, fileId);
            if (display) byName.set(display, fileId);
        }
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
async function getWorld(fileId) {
    const data = await stPostJson('/api/worldinfo/get', { name: normalizeWorldId(fileId) });
    return data;
}
function extractWorldData(payload) {
    if (!payload || typeof payload !== 'object') return null;
    if (payload.data && typeof payload.data === 'object' && (payload.data.entries || payload.data.originalData)) return payload.data;
    if (payload.world && typeof payload.world === 'object' && (payload.world.entries || payload.world.originalData)) return payload.world;
    return payload;
}
function getOriginalCharacterBook(data) {
    const candidates = [data?.originalData, data?.data?.originalData, data?.extensions?.originalData];
    for (const original of candidates) {
        if (original && typeof original === 'object' && original.entries) return original;
    }
    return null;
}
function getEntryCount(data) {
    const entries = data?.entries;
    return Array.isArray(entries) ? entries.length : (entries && typeof entries === 'object' ? Object.keys(entries).length : 0);
}
async function scanEmbeddedWorlds(characters, settings, progress) {
    const worlds = await listWorlds();
    const provenance = updateWorldProvenance(characters, worlds, settings);
    const liveRefs = new Map();
    const addRef = (world, source) => {
        const id = normalizeWorldId(world);
        if (!id) return;
        if (!liveRefs.has(id)) liveRefs.set(id, new Set());
        liveRefs.get(id).add(source);
    };
    for (const character of characters) {
        const primary = getWorldBindingNames(character);
        if (primary) addRef(primary, `角色：${character?.name || '未知角色'}`);
    }
    for (const world of getAuxWorldBindingsFromSettings(settings)) addRef(world, '角色附加 World Info');
    for (const world of getGlobalWorldBindingsFromSettings(settings)) addRef(world, '全局 World Info');
    const personaWorld = getPersonaWorldBindingFromSettings(settings);
    if (personaWorld) addRef(personaWorld, 'Persona Lore');
    const currentChatWorld = getCurrentChatWorldBinding();
    if (currentChatWorld) addRef(currentChatWorld, '当前聊天 Lore');

    const candidates = [], diagnostics = [], errors = [];
    for (let i = 0; i < worlds.length; i++) {
        const item = worlds[i] || {};
        const fileId = normalizeWorldId(item.file_id ?? item.name);
        const displayName = String(item.name || fileId);
        if (!fileId) continue;
        progress?.(`检查角色卡遗留世界书 ${i + 1}/${worlds.length}…`);
        try {
            const data = extractWorldData(await getWorld(fileId));
            const original = getOriginalCharacterBook(data);
            const refs = [...(liveRefs.get(fileId) || [])];
            const remembered = provenance[fileId];
            if (!original) {
                diagnostics.push({ fileId, name: displayName, kind: '普通世界书', reason: '未发现 Character Book originalData' });
                continue;
            }
            if (refs.length > 0) {
                diagnostics.push({ fileId, name: displayName, kind: '角色卡来源但仍在使用', reason: refs.join('、') });
                continue;
            }
            const sourceCharacter = remembered?.sourceCharacter || String(original?.name || '').replace(/['’]s Lorebook$/i, '') || '未知角色（已删除）';
            candidates.push({
                worldId: fileId,
                fileId,
                name: displayName,
                entries: getEntryCount(data),
                sourceName: String(original?.name || ''),
                sourceCharacter,
                provenance: 'Character Book（originalData）',
                confidence: remembered ? 'high' : 'medium',
                reasons: [remembered ? '此前记录过角色卡来源' : '世界书仍保留 Character Book originalData', '当前未发现角色/全局/Persona/当前聊天引用'],
            });
        } catch (error) {
            errors.push({ kind: 'world', fileId, error });
        }
    }
    return { total: worlds.length, candidates, diagnostics, errors };
}
async function scanOldChats(days, characters, progress) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const candidates = [], errors = [], seen = new Set();
    for (let i = 0; i < characters.length; i++) {
        const character = characters[i] || {}, avatar = character.avatar;
        if (!avatar) continue;
        progress?.(`检查聊天 ${i + 1}/${characters.length}…`);
        try {
            const response = await stFetch('/api/characters/chats', { method: 'POST', body: JSON.stringify({ avatar_url: avatar }) });
            if (!response.ok) {
                errors.push({ kind: 'chat', character, error: new Error(`HTTP ${response.status}`) });
                continue;
            }
            const data = await response.json();
            if (!data || data.error === true) continue;
            for (const chat of Object.values(data)) {
                if (!chat || !chat.file_name) continue;
                const time = parseChatTimestamp(chat.last_mes);
                if (!Number.isFinite(time) || time >= cutoff) continue;
                const fileName = String(chat.file_name).replace(/\.jsonl$/i, '');
                const dedupeKey = `${avatar}::${fileName}`;
                if (seen.has(dedupeKey)) continue;
                seen.add(dedupeKey);
                const current = character.chat && String(character.chat) === fileName;
                candidates.push({ characterName: character.name || '未知角色', avatar, fileName, chatId: dedupeKey, time, current });
            }
        } catch (error) {
            errors.push({ kind: 'chat', character, error });
        }
    }
    candidates.sort((a, b) => a.time - b.time);
    return { candidates, errors };
}
function parseChatTimestamp(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
    if (typeof value !== 'string') return NaN;
    const trimmed = value.trim();
    if (!trimmed) return NaN;
    if (/^\d+$/.test(trimmed)) {
        const n = Number(trimmed);
        return n < 1e12 ? n * 1000 : n;
    }
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : NaN;
}
function formatDate(timestamp) { return new Date(timestamp).toLocaleString(); }
async function scanWebCaches() {
    if (!('caches' in globalThis)) return { supported: false, caches: [] };
    const names = await caches.keys();
    const result = [];
    for (const name of names) {
        let entries = [];
        try { entries = await (await caches.open(name)).keys(); } catch { }
        result.push({ name, cacheId: name, entries: entries.length, kind: 'web_cache' });
    }
    return { supported: true, caches: result };
}
function collectInstalledExtensionIds() {
    const ids = new Set(['xiaozhong-toolbox']);
    const roots = document.querySelectorAll('#extensions_settings2 .inline-drawer, #extensions_settings .inline-drawer');
    roots.forEach(el => {
        const id = el.getAttribute('data-extension-id') || el.id?.replace(/^extension_/, '');
        if (id) ids.add(id);
    });
    const extSettings = globalThis.extension_settings && typeof globalThis.extension_settings === 'object' ? globalThis.extension_settings : {};
    for (const key of Object.keys(extSettings)) {
        if (key === 'disabled_extensions') continue;
    }
    return ids;
}
function scanExtensionSettingsResidues() {
    const settings = globalThis.extension_settings;
    if (!settings || typeof settings !== 'object') return { candidates: [], supported: false };
    const installedIds = collectInstalledExtensionIds();
    const candidates = [];
    for (const key of Object.keys(settings)) {
        if (installedIds.has(key)) continue;
        // Only flag object-like extension setting namespaces. Primitive global settings are not touched.
        if (settings[key] && typeof settings[key] === 'object') {
            candidates.push({ id: key, valueType: 'object', kind: 'extension_settings', note: '发现未对应到当前扩展界面的设置命名空间；仅在确认后删除。' });
        }
    }
    return { candidates, supported: true };
}
function discoverHostCleanup() {
    const api = globalThis.__TAURITAVERN__?.api;
    return {
        cacheScan: typeof api?.cache?.scan === 'function',
        cacheClear: typeof api?.cache?.clearSafe === 'function' || typeof api?.cache?.clear === 'function',
        tempScan: typeof api?.files?.scanTemp === 'function' || typeof api?.files?.listTemp === 'function',
        tempClear: typeof api?.files?.clearTemp === 'function' || typeof api?.files?.cleanupTemp === 'function',
        filesystem: typeof api?.files === 'object',
    };
}
async function clearSelectedWorlds(selected) {
    let deleted = 0, failures = [];
    for (const item of selected) {
        try {
            const response = await stFetch('/api/worldinfo/delete', { method: 'POST', body: JSON.stringify({ name: normalizeWorldId(item) }) });
            if (response.ok) deleted++; else failures.push(`${item}: HTTP ${response.status}`);
        } catch (error) { failures.push(`${item}: ${error?.message || error}`); }
    }
    return { deleted, failures };
}
async function clearSelectedChats(selected) {
    let deleted = 0, failures = [];
    for (const item of selected) {
        if (item.current) { failures.push(`${item.fileName}: 当前聊天`); continue; }
        try {
            const response = await stFetch('/api/chats/delete', { method: 'POST', body: JSON.stringify({ chatfile: `${item.fileName}.jsonl`, avatar_url: item.avatar }) });
            if (response.ok) deleted++; else failures.push(`${item.fileName}: HTTP ${response.status}`);
        } catch (error) { failures.push(`${item.fileName}: ${error?.message || error}`); }
    }
    return { deleted, failures };
}
async function clearSelectedWebCaches(selected) {
    let deleted = 0, failures = [];
    if (!('caches' in globalThis)) return { deleted: 0, failures: ['当前环境没有 Cache Storage API'] };
    for (const name of selected) {
        try { if (await caches.delete(name)) deleted++; else failures.push(`${name}: 未找到`); }
        catch (error) { failures.push(`${name}: ${error?.message || error}`); }
    }
    return { deleted, failures };
}
async function clearExtensionSettingResidue(selected) {
    const settings = globalThis.extension_settings;
    const before = [];
    if (!settings || typeof settings !== 'object') return { deleted: 0, failures: ['当前环境没有 extension_settings'] };
    for (const id of selected) {
        if (!(id in settings)) continue;
        before.push(id);
        delete settings[id];
    }
    if (before.length) {
        try {
            if (typeof globalThis.saveSettingsDebounced === 'function') globalThis.saveSettingsDebounced();
            else if (typeof globalThis.SillyTavern?.getContext === 'function') globalThis.SillyTavern.getContext()?.saveSettingsDebounced?.();
        } catch (error) { return { deleted: 0, failures: [`保存设置失败：${error?.message || error}`] }; }
    }
    return { deleted: before.length, failures: [] };
}
function makeCleanState() {
    return {
        worldCandidates: [],
        chatCandidates: [],
        webCaches: [],
        extensionCandidates: [],
        host: {},
        errors: [],
        worldDiagnostics: [],
        scannedAt: Date.now(),
    };
}
function renderCleanResults(root, state) {
    const box = root.querySelector('[data-clean-results]');
    box.innerHTML = '';
    const groups = [
        ['worldId', '🌍 角色卡导入遗留世界书', state.worldCandidates],
        ['chatId', '🗨️ 超过设定天数未使用的聊天', state.chatCandidates],
        ['cacheId', '🌐 浏览器 Cache Storage', state.webCaches],
        ['extensionId', '🧩 可疑扩展设置残留', state.extensionCandidates],
    ];
    const total = groups.reduce((sum, [, , rows]) => sum + rows.length, 0);
    const summary = document.createElement('div');
    summary.className = 'xztb-summary';
    summary.textContent = `全面扫描完成：发现 ${total} 个候选项目。`;
    box.appendChild(summary);
    const toolbar = document.createElement('div'); toolbar.className = 'xztb-row';
    const selectAll = document.createElement('button'); selectAll.type = 'button'; selectAll.className = 'menu_button'; selectAll.textContent = '☑ 全选所有候选';
    selectAll.addEventListener('click', () => box.querySelectorAll('input[type="checkbox"]:not(:disabled)').forEach(input => input.checked = true));
    const selectSafe = document.createElement('button'); selectSafe.type = 'button'; selectSafe.className = 'menu_button'; selectSafe.textContent = '✅ 全选高置信度';
    selectSafe.addEventListener('click', () => box.querySelectorAll('input[data-confidence="high"]:not(:disabled)').forEach(input => input.checked = true));
    const clearAll = document.createElement('button'); clearAll.type = 'button'; clearAll.className = 'menu_button'; clearAll.textContent = '🗑️ 清理已选'; clearAll.addEventListener('click', () => handleCleanAction(root, 'all'));
    toolbar.append(selectAll, selectSafe, clearAll); box.appendChild(toolbar);
    const renderGroup = (title, rows, key, detailFn, disabledFn = () => false, confidenceFn = () => '') => {
        const details = document.createElement('details'); details.open = rows.length > 0; details.className = 'xztb-clean-group';
        const summaryEl = document.createElement('summary'); summaryEl.textContent = `${title}（${rows.length}）`; details.appendChild(summaryEl);
        if (!rows.length) { const empty = document.createElement('div'); empty.className = 'xztb-note'; empty.textContent = '没有发现。'; details.appendChild(empty); box.appendChild(details); return; }
        const list = document.createElement('div'); list.className = 'xztb-list';
        for (const rowData of rows) {
            const label = document.createElement('label'); label.className = 'xztb-check-row';
            const input = document.createElement('input'); input.type = 'checkbox'; input.disabled = disabledFn(rowData); input.dataset[key] = '1'; input.value = rowData[key] ?? rowData.name ?? rowData.id ?? '';
            const conf = confidenceFn(rowData); if (conf) input.dataset.confidence = conf;
            const text = document.createElement('span'); const titleEl = document.createElement('b'); titleEl.textContent = rowData.name || rowData.fileName || rowData.characterName || rowData.id;
            const small = document.createElement('small'); small.textContent = detailFn(rowData); text.append(titleEl, small); label.append(input, text); list.appendChild(label);
        }
        details.appendChild(list); box.appendChild(details);
    };
    renderGroup(groups[0][1], state.worldCandidates, 'worldId', r => `${r.sourceCharacter}；${r.entries} 个条目；${r.reasons.join('；')}`, () => false, r => r.confidence);
    renderGroup(groups[1][1], state.chatCandidates, 'chatId', r => `${formatDate(r.time)}；角色：${r.characterName}${r.current ? '；当前聊天，不允许删除' : ''}`, r => r.current);
    renderGroup(groups[2][1], state.webCaches, 'cacheId', r => `${r.entries} 个缓存请求；删除后相关网页资源会重新缓存`);
    renderGroup(groups[3][1], state.extensionCandidates, 'extensionId', r => r.note);
    const host = document.createElement('details'); host.className = 'xztb-clean-group';
    const hs = document.createElement('summary'); hs.textContent = '🧹 TauriTavern 宿主缓存 / 临时文件'; host.appendChild(hs);
    const hnote = document.createElement('div'); hnote.className = 'xztb-note';
    const caps = state.host;
    hnote.textContent = caps.tempScan || caps.cacheScan ? '检测到宿主相关能力，但当前公开契约没有经过本版本验证的通用扫描/删除参数；因此不自动猜路径。' : '当前版本没有公开可安全调用的宿主临时文件/系统 HTTP 缓存清理接口；本项不猜目录。';
    host.appendChild(hnote); box.appendChild(host);
    if (state.errors.length) {
        const error = document.createElement('div'); error.className = 'xztb-note';
        error.textContent = `有 ${state.errors.length} 个子扫描/项目读取失败；失败项目不会进入可清理列表。具体信息已写入控制台。`;
        box.appendChild(error);
    }
}
async function scanAllCleanup(root) {
    const status = root.querySelector('[data-clean-status]');
    const results = root.querySelector('[data-clean-results]');
    status.textContent = '正在全面扫描…'; results.innerHTML = '';
    const state = makeCleanState();
    console.info('[小众工具箱] === 清理全面扫描开始 ===');
    try {
        const [characters, settingsResult] = await Promise.all([
            getCharacters(),
            stPostJson('/api/settings/get', {}),
        ]);
        const settings = settingsResult && typeof settingsResult === 'object' ? settingsResult : {};
        const jobs = [
            ['world', () => scanEmbeddedWorlds(characters, settings, s => status.textContent = s)],
            ['chat', () => scanOldChats(Number(root.querySelector('[data-chat-days]').value) || 15, characters, s => status.textContent = s)],
            ['webcache', () => scanWebCaches()],
            ['extension', () => scanExtensionSettingsResidues()],
        ];
        const settled = await Promise.allSettled(jobs.map(([, fn]) => fn()));
        for (let i = 0; i < settled.length; i++) {
            const [kind] = jobs[i]; const item = settled[i];
            if (item.status === 'rejected') { state.errors.push({ kind, error: item.reason }); continue; }
            if (kind === 'world') { state.worldCandidates = item.value.candidates; state.worldDiagnostics = item.value.diagnostics; state.errors.push(...item.value.errors); }
            if (kind === 'chat') { state.chatCandidates = item.value.candidates; state.errors.push(...item.value.errors); }
            if (kind === 'webcache') state.webCaches = item.value.caches;
            if (kind === 'extension') state.extensionCandidates = item.value.candidates;
        }
        state.host = discoverHostCleanup();
        root.__xztbCleanState = state;
        renderCleanResults(root, state);
        console.info('[小众工具箱] 清理扫描结果:', {
            worldCandidates: state.worldCandidates.length,
            oldChats: state.chatCandidates.length,
            webCaches: state.webCaches.length,
            extensionResidues: state.extensionCandidates.length,
            host: state.host,
            errors: state.errors.length,
        });
        status.textContent = `全面扫描完成：${state.worldCandidates.length + state.chatCandidates.length + state.webCaches.length + state.extensionCandidates.length} 个候选。`;
    } catch (error) {
        console.error('[小众工具箱] 清理全面扫描失败:', error);
        status.textContent = `扫描失败：${error?.message || error}`;
    }
}
async function handleCleanAction(root, key) {
    const state = root.__xztbCleanState;
    if (!state) return;
    const selected = {
        worlds: [...root.querySelectorAll('input[data-worldId]:checked')].map(x => x.value),
        chats: [...root.querySelectorAll('input[data-chatId]:checked')].map(x => state.chatCandidates.find(r => r.chatId === x.value)).filter(Boolean),
        caches: [...root.querySelectorAll('input[data-cacheId]:checked')].map(x => x.value),
        extensions: [...root.querySelectorAll('input[data-extensionId]:checked')].map(x => x.value),
    };
    const total = selected.worlds.length + selected.chats.length + selected.caches.length + selected.extensions.length;
    if (!total) return;
    if (!confirm(`确定清理选中的 ${total} 项吗？删除操作不可恢复。`)) return;
    const status = root.querySelector('[data-clean-status]');
    status.textContent = '正在清理…';
    const results = await Promise.allSettled([
        selected.worlds.length ? clearSelectedWorlds(selected.worlds) : Promise.resolve({ deleted: 0, failures: [] }),
        selected.chats.length ? clearSelectedChats(selected.chats) : Promise.resolve({ deleted: 0, failures: [] }),
        selected.caches.length ? clearSelectedWebCaches(selected.caches) : Promise.resolve({ deleted: 0, failures: [] }),
        selected.extensions.length ? clearExtensionSettingResidue(selected.extensions) : Promise.resolve({ deleted: 0, failures: [] }),
    ]);
    let deleted = 0, failures = [];
    for (const item of results) {
        if (item.status === 'fulfilled') { deleted += item.value.deleted; failures.push(...item.value.failures); }
        else failures.push(item.reason?.message || String(item.reason));
    }
    console.info('[小众工具箱] 清理执行:', { requested: total, deleted, failures });
    status.textContent = `清理完成：已处理 ${deleted} 项${failures.length ? `，失败 ${failures.length} 项` : ''}。`;
    await scanAllCleanup(root);
}

let jsZipPromise = null;
async function loadJsZip() {
    if (globalThis.JSZip) return globalThis.JSZip;
    if (!jsZipPromise) {
        jsZipPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = new URL('./jszip.min.js', import.meta.url).href;
            script.onload = () => globalThis.JSZip ? resolve(globalThis.JSZip) : reject(new Error('ZIP 解压组件加载失败。'));
            script.onerror = () => reject(new Error('无法加载本地 ZIP 解压组件。'));
            document.head.appendChild(script);
        });
    }
    return jsZipPromise;
}

function isUnsafeZipPath(path) {
    const value = String(path || '').replace(/\\/g, '/');
    if (!value || value.startsWith('/') || /^[A-Za-z]:\//.test(value)) return true;
    const parts = value.split('/').filter(Boolean);
    return parts.some(part => part === '..');
}

function zipManifestInfo(manifest) {
    if (!manifest || typeof manifest !== 'object') throw new Error('ZIP 中的 manifest.json 不是有效对象。');
    const displayName = String(manifest.display_name || manifest.name || manifest.title || '').trim();
    const author = String(manifest.author || '').trim();
    const version = String(manifest.version || '').trim();
    const js = manifest.js;
    if (!displayName) throw new Error('manifest.json 缺少扩展名称。');
    if (!(typeof js === 'string' || Array.isArray(js))) throw new Error('manifest.json 缺少 js 入口。');
    return { displayName, author, version, js };
}

async function inspectZip(file, status, actions) {
    const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    const isZip = header.length === 4 && header[0] === 0x50 && header[1] === 0x4b && (header[2] === 0x03 || header[2] === 0x05 || header[2] === 0x07) && (header[3] === 0x04 || header[3] === 0x06 || header[3] === 0x08);
    if (!isZip) throw new Error('这个文件不是有效的 ZIP 文件。');

    const JSZip = await loadJsZip();
    const zip = await JSZip.loadAsync(file, { createFolders: false, checkCRC32: true });
    const files = Object.values(zip.files || {});
    const unsafe = files.find(entry => isUnsafeZipPath(entry.name));
    if (unsafe) throw new Error(`ZIP 含有不安全路径：${unsafe.name}`);
    const fileEntries = files.filter(entry => !entry.dir);
    if (!fileEntries.length) throw new Error('ZIP 不包含可安装文件。');

    const manifestEntries = fileEntries.filter(entry => entry.name.split('/').pop().toLowerCase() === 'manifest.json');
    if (!manifestEntries.length) throw new Error('ZIP 中找不到 manifest.json，无法识别为 TauriTavern 扩展。');
    if (manifestEntries.length > 1) throw new Error('ZIP 中发现多个 manifest.json，无法安全判断哪个是扩展根目录。');
    const manifestEntry = manifestEntries[0];
    const manifestText = await manifestEntry.async('text');
    let manifest;
    try { manifest = JSON.parse(manifestText); } catch { throw new Error('manifest.json 解析失败。'); }
    const info = zipManifestInfo(manifest);
    const parts = manifestEntry.name.replace(/\\/g, '/').split('/').filter(Boolean);
    const rootPrefix = parts.length > 1 ? `${parts.slice(0, -1).join('/')}/` : '';
    const relativeFiles = fileEntries.filter(entry => entry.name.startsWith(rootPrefix));
    const invalidOutsideRoot = fileEntries.some(entry => !entry.name.startsWith(rootPrefix));
    if (invalidOutsideRoot && rootPrefix) throw new Error('ZIP 的文件结构超出扩展根目录，无法安全安装。');

    let compressedBytes = file.size;
    let extractedBytes = 0;
    for (const entry of relativeFiles) {
        if (!entry.dir) {
            const data = await entry.async('uint8array');
            extractedBytes += data.byteLength;
            if (extractedBytes > 200 * 1024 * 1024) throw new Error('解压后文件总大小超过 200 MB，已停止。');
        }
    }

    status.textContent = `已读取：${file.name}（${Math.round(compressedBytes / 1024)} KB）`;
    actions.innerHTML = '';
    const infoBox = document.createElement('div');
    infoBox.className = 'xztb-result';
    infoBox.textContent = `识别到扩展：${info.displayName}${info.version ? ` v${info.version}` : ''}${info.author ? ` · ${info.author}` : ''}；文件 ${relativeFiles.length} 个，解压后约 ${Math.round(extractedBytes / 1024)} KB。`;
    actions.appendChild(infoBox);

    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.className = 'menu_button';
    confirmButton.textContent = '确认导入 / 安装';
    confirmButton.addEventListener('click', () => installLocalZip(file, { info, rootPrefix }, status, actions));
    actions.appendChild(confirmButton);
}

async function getHostExtensions() {
    const host = globalThis.__TAURITAVERN__;
    try {
        if (typeof host?.invoke?.safeInvoke === 'function') return await host.invoke.safeInvoke('get_extensions', {});
    } catch (error) {
        console.warn('[小众工具箱] get_extensions 调用失败:', error);
    }
    return null;
}

function findLocalExtensionPath(file) {
    const candidate = file?.path || file?.webkitPath || file?.fullPath || '';
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    return '';
}

async function invokeNativeInstall(command, payload) {
    const host = globalThis.__TAURITAVERN__;
    if (typeof host?.invoke?.safeInvoke !== 'function') throw new Error('当前环境没有可用的 TauriTavern Host invoke 通道。');
    return host.invoke.safeInvoke(command, payload);
}

async function installLocalZip(file, context, status, actions) {
    const api = globalThis.__TAURITAVERN__?.api;
    const directCandidates = [api?.extensions?.installZip, api?.extensions?.installFromZip, api?.installExtensionZip].filter(fn => typeof fn === 'function');
    if (directCandidates.length) {
        try {
            status.textContent = '正在通过 TauriTavern 扩展安装器导入…';
            await directCandidates[0].call(api.extensions || api, { file, overwrite: true });
            status.textContent = '扩展安装完成。请在扩展列表刷新/重载后使用。';
            return;
        } catch (error) {
            status.textContent = `宿主 ZIP 安装接口调用失败：${error?.message || error}`;
        }
    }

    const localPath = findLocalExtensionPath(file);
    if (localPath) {
        try {
            status.textContent = '正在使用 TauriTavern 原生扩展安装命令…';
            const result = await invokeNativeInstall('install_extension', { url: localPath, global: false, branch: null });
            status.textContent = `扩展安装完成${result ? `：${String(result)}` : ''}。请刷新扩展列表。`;
            return;
        } catch (error) {
            console.warn('[小众工具箱] 原生 install_extension 失败:', error);
            status.textContent = `原生扩展安装命令未接受本机路径：${error?.message || error}`;
        }
    }

    const hostExtensions = await getHostExtensions();
    const extensionHint = hostExtensions ? '当前 Host 能读取已安装扩展，但公开安装命令只接受远程扩展来源。' : '当前 Host 没有公开本机 ZIP 安装接口。';
    const existing = document.createElement('div');
    existing.className = 'xztb-result';
    existing.textContent = `已完成 ZIP 解压验证，但还不能写入 TauriTavern 扩展目录。${extensionHint} 本机文件选择器不会暴露 iOS 应用私有路径，不能靠普通网页 File API 直接把文件搬进 third-party extensions。`;
    actions.appendChild(existing);
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
                <div class="xztb-group"><div class="xztb-row"><label class="xztb-inline-label">聊天闲置超过 <input class="text_pole xztb-days" type="number" min="1" value="15" data-chat-days> 天</label><button class="menu_button" type="button" data-clean-scan>🔍 一键全面扫描</button></div><div class="xztb-status" data-clean-status></div><div class="xztb-note">扫描会同时检查旧聊天、角色卡导入遗留世界书、浏览器 Cache Storage 和可识别的扩展设置残留。TauriTavern 私有缓存只在有安全公开接口时处理。</div><div class="xztb-list" data-clean-results></div></div>
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

const EXT_ID = 'xiaozhong-toolbox';
const EXT_VERSION = '0.3.3';
const STORE_NAMESPACE = 'xiaozhong-toolbox';

function getHost() {
    return globalThis.__TAURITAVERN__;
}

async function waitHost() {
    const host = getHost();
    const ready = host?.ready || globalThis.__TAURITAVERN_MAIN_READY__;
    if (ready && typeof ready.then === 'function') await ready;
    return getHost();
}

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
    return link;
}

function clearOldDownloads(container) {
    container.querySelectorAll('[data-xztb-download="1"]').forEach(el => el.remove());
}

function indentJson(value) {
    return JSON.stringify(value, null, 4) + '\n';
}

function getPromptOrderIds(root, orderIndex = 0) {
    if (!Array.isArray(root?.prompt_order)) return [];
    const groups = root.prompt_order.filter(group => group && Array.isArray(group.order));
    const selected = groups[orderIndex] || groups[0];
    if (!selected) return [];
    const ids = [];
    const seen = new Set();
    for (const item of selected.order) {
        const id = item?.identifier;
        if (typeof id === 'string' && !seen.has(id)) {
            seen.add(id);
            ids.push(id);
        }
    }
    return ids;
}

function reorderPresetPrompts(root, orderIndex = 0) {
    if (!root || !Array.isArray(root.prompts) || !Array.isArray(root.prompt_order)) {
        throw new Error('不是可识别的 Preset：缺少 prompts 或 prompt_order。');
    }
    const groups = root.prompt_order.filter(group => group && Array.isArray(group.order));
    if (!groups.length) throw new Error('不是可识别的 Preset：prompt_order 中没有有效的 order。');
    const idSequence = getPromptOrderIds(root, orderIndex);
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
    for (const prompt of root.prompts) {
        if (!usedObjects.has(prompt)) result.push(prompt);
    }
    const output = { ...root, prompts: result };
    const referenced = idSequence.filter(id => byId.has(id)).length;
    return {
        output,
        total: root.prompts.length,
        referenced,
        unreferenced: root.prompts.length - referenced,
        groups: groups.length,
        selectedGroup: orderIndex < groups.length ? orderIndex : 0,
    };
}

async function handlePresetFile(file, statusContainer, orderIndex = 0) {
    clearOldDownloads(statusContainer);
    const text = await file.text();
    let root;
    try {
        root = JSON.parse(text);
    } catch {
        throw new Error('JSON 解析失败：文件不是有效 JSON。');
    }
    const { output, total, referenced, unreferenced, groups, selectedGroup } = reorderPresetPrompts(root, orderIndex);
    const filename = `${getOutputStem(file.name, '_整理后')}.json`;
    const blob = new Blob([indentJson(output)], { type: 'application/json;charset=utf-8' });
    const link = createBlobSaveLink(blob, filename);
    const result = document.createElement('div');
    result.className = 'xztb-result';
    result.textContent = `整理完成：共 ${total} 个条目，按第 ${selectedGroup + 1}/${groups} 个 prompt_order 排序组排列 ${referenced} 个，未被该排序组引用的 ${unreferenced} 个保留在末尾。`;
    statusContainer.append(result, link);
}

async function canvasToCompressedPng(canvas, colors = 256) {
    const native = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (colors === 0) return native;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('无法读取图片像素。');
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
        counts[key]++;
        sumsR[key] += r;
        sumsG[key] += g;
        sumsB[key] += b;
        sumsA[key] += a;
    }
    const occupied = [];
    for (let key = 0; key < bins; key++) if (counts[key]) occupied.push(key);
    occupied.sort((a, b) => counts[b] - counts[a]);
    const paletteKeys = occupied.slice(0, Math.min(colors, occupied.length));
    if (!paletteKeys.length) return native;
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
        if (!counts[key]) continue;
        const r = ((key >> 10) & 31) * 8 + 4;
        const g = ((key >> 5) & 31) * 8 + 4;
        const b = (key & 31) * 8 + 4;
        let best = 0, bestDistance = Infinity;
        for (let p = 0; p < paletteKeys.length; p++) {
            const pr = palette[p * 4], pg = palette[p * 4 + 1], pb = palette[p * 4 + 2];
            const dr = r - pr, dg = g - pg, db = b - pb;
            const distance = dr * dr + dg * dg + db * db;
            if (distance < bestDistance) {
                bestDistance = distance;
                best = p;
            }
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
    if (!globalThis.CompressionStream) return native;
    let compressed;
    try {
        compressed = await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer();
    } catch {
        return native;
    }
    const pngSignature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const makeChunk = (type, payload) => {
        const typeBytes = new TextEncoder().encode(type);
        const buffer = new Uint8Array(12 + payload.length);
        const view = new DataView(buffer.buffer);
        view.setUint32(0, payload.length);
        buffer.set(typeBytes, 4);
        buffer.set(payload, 8);
        view.setUint32(buffer.length - 4, crc32Concat(typeBytes, payload));
        return buffer;
    };
    const ihdr = new ArrayBuffer(13), ihdrView = new DataView(ihdr);
    ihdrView.setUint32(0, width);
    ihdrView.setUint32(4, height);
    ihdrView.setUint8(8, 8);
    ihdrView.setUint8(9, 3);
    const plte = new Uint8Array(paletteKeys.length * 3), trns = new Uint8Array(paletteKeys.length);
    let hasAlpha = false;
    for (let i = 0; i < paletteKeys.length; i++) {
        plte[i * 3] = palette[i * 4];
        plte[i * 3 + 1] = palette[i * 4 + 1];
        plte[i * 3 + 2] = palette[i * 4 + 2];
        trns[i] = palette[i * 4 + 3];
        if (trns[i] !== 255) hasAlpha = true;
    }
    const parts = [pngSignature, makeChunk('IHDR', new Uint8Array(ihdr)), makeChunk('PLTE', plte)];
    if (hasAlpha) parts.push(makeChunk('tRNS', trns));
    parts.push(makeChunk('IDAT', new Uint8Array(compressed)), makeChunk('IEND', new Uint8Array()));
    const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
        result.set(part, offset);
        offset += part.length;
    }
    const blob = new Blob([result], { type: 'image/png' });
    return native && blob.size >= native.size ? native : blob;
}

let crcTable = null;
function crc32(bytes) {
    if (!crcTable) {
        crcTable = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
            crcTable[n] = c >>> 0;
        }
    }
    let c = 0xffffffff;
    for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}
function crc32Concat(a, b) {
    const joined = new Uint8Array(a.length + b.length);
    joined.set(a);
    joined.set(b, a.length);
    return crc32(joined);
}

function qualityToLabel(value) {
    const n = Math.round(Number(value) * 100);
    return `${n}%`;
}

async function convertImage(file, format, options, statusContainer) {
    if (!file?.type?.startsWith('image/')) throw new Error('请选择图片文件。');
    clearOldDownloads(statusContainer);
    const { quality = 0.82, maxDimension = 0, pngColors = 256 } = options || {};
    if (format === 'png' && file.type === 'image/png' && pngColors === 0 && !maxDimension) {
        const link = createBlobSaveLink(file, file.name);
        const result = document.createElement('div');
        result.className = 'xztb-result';
        result.textContent = `图片已经是 PNG 且选择了无损直出，无需重新编码（${Math.round(file.size / 1024)} KB）。`;
        statusContainer.append(result, link);
        return;
    }
    const bitmap = await createImageBitmap(file);
    try {
        let width = bitmap.width, height = bitmap.height;
        if (maxDimension > 0 && Math.max(width, height) > maxDimension) {
            const scale = maxDimension / Math.max(width, height);
            width = Math.max(1, Math.round(width * scale));
            height = Math.max(1, Math.round(height * scale));
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { alpha: format !== 'jpeg', willReadFrequently: format === 'png' && pngColors > 0 });
        if (!ctx) throw new Error('当前环境无法创建图片画布。');
        if (format === 'jpeg') {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, width, height);
        }
        ctx.drawImage(bitmap, 0, 0, width, height);
        let blob;
        if (format === 'png') blob = await canvasToCompressedPng(canvas, pngColors);
        else {
            const mime = format === 'jpeg' ? 'image/jpeg' : 'image/webp';
            blob = await new Promise(resolve => canvas.toBlob(resolve, mime, quality));
        }
        if (!blob) throw new Error('图片转换失败。');
        const ext = format === 'jpeg' ? 'jpg' : format;
        const filename = `${getOutputStem(file.name)}.${ext}`;
        const link = createBlobSaveLink(blob, filename);
        const result = document.createElement('div');
        result.className = 'xztb-result';
        const ratio = file.size ? (blob.size / file.size).toFixed(2) : '-';
        const qualityText = format === 'png' ? (pngColors === 0 ? 'PNG 无损' : `PNG ${pngColors} 色`) : `${format.toUpperCase()} ${qualityToLabel(quality)}`;
        result.textContent = `转换完成：${file.name} → ${ext.toUpperCase()}（${width}×${height}，${Math.round(blob.size / 1024)} KB；原文件 ${Math.round(file.size / 1024)} KB；${qualityText}）。`;
        if (ratio !== '-') result.textContent += ` 体积倍率 ${ratio}×。`;
        statusContainer.append(result, link);
    } finally {
        bitmap.close?.();
    }
}

async function getStRequestHeaders() {
    try {
        const script = await import('/script.js');
        if (typeof script.getRequestHeaders === 'function') return script.getRequestHeaders();
    } catch {
    }
    return { 'Content-Type': 'application/json' };
}

async function stFetch(url, options = {}) {
    const headers = new Headers(options.headers || await getStRequestHeaders());
    return fetch(url, { ...options, headers, cache: 'no-store' });
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

function addWorldRef(map, value, source) {
    const key = normalizeWorldId(value);
    if (!key) return;
    const list = map.get(key) || [];
    if (!list.includes(source)) list.push(source);
    map.set(key, list);
}

function collectCharacterWorldRefs(characters) {
    const refs = new Map();
    for (const character of characters) {
        const characterName = String(character?.name || '未知角色');
        addWorldRef(refs, character?.data?.extensions?.world, `角色：${characterName}（主世界书）`);
        const extra = character?.data?.extensions?.world_info?.charLore;
        if (Array.isArray(extra)) {
            for (const row of extra) {
                for (const name of row?.extraBooks || []) addWorldRef(refs, name, `角色：${characterName}（辅助世界书）`);
            }
        }
    }
    return refs;
}

async function loadWorldProvenance() {
    const host = getHost();
    const store = host?.api?.extension?.store;
    if (store?.tryGetJson) {
        try {
            const result = await store.tryGetJson({ namespace: STORE_NAMESPACE, key: 'world-provenance' });
            return result?.found && result.value && typeof result.value === 'object' ? result.value : {};
        } catch {
        }
    }
    try {
        const raw = localStorage.getItem('xiaozhong_toolbox_world_provenance_v1');
        const parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

async function saveWorldProvenance(provenance) {
    const host = getHost();
    const store = host?.api?.extension?.store;
    if (store?.setJson) {
        try {
            await store.setJson({ namespace: STORE_NAMESPACE, key: 'world-provenance', value: provenance });
            return;
        } catch {
        }
    }
    try {
        localStorage.setItem('xiaozhong_toolbox_world_provenance_v1', JSON.stringify(provenance));
    } catch {
    }
}

async function updateWorldProvenance(characters, worlds) {
    const provenance = await loadWorldProvenance();
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
        const book = character?.data?.character_book;
        const bookName = normalizeWorldId(book?.name);
        if (!bookName) continue;
        const worldId = byName.get(bookName) || bookName;
        provenance[worldId] = {
            worldId,
            sourceCharacter: String(character?.name || '未知角色'),
            sourceAvatar: String(character?.avatar || ''),
            sourceBookName: String(book?.name || ''),
            recordedAt: Date.now(),
        };
    }
    await saveWorldProvenance(provenance);
    return provenance;
}

async function listWorlds() {
    const data = await stPostJson('/api/worldinfo/list', {});
    if (!Array.isArray(data)) throw new Error('世界书列表返回格式异常。');
    return data;
}

async function getWorld(fileId) {
    return stPostJson('/api/worldinfo/get', { name: normalizeWorldId(fileId) });
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
        if (original && typeof original === 'object' && (Array.isArray(original.entries) || (original.entries && typeof original.entries === 'object'))) return original;
    }
    return null;
}

function collectGlobalWorldRefs(settings) {
    const refs = new Map();
    const globalSelect = settings?.globalSelect ?? settings?.world_info?.globalSelect ?? settings?.world_info?.selected_world_info ?? settings?.world_info_settings?.world_info?.globalSelect;
    if (Array.isArray(globalSelect)) {
        for (const name of globalSelect) addWorldRef(refs, name, '全局世界书选择');
    }
    return refs;
}

function collectCurrentChatWorldRef() {
    const refs = new Map();
    const candidates = [
        globalThis.chat_metadata?.world_info,
        globalThis.chat_metadata?.worldInfo,
        globalThis.chat_metadata?.chat_world,
        globalThis.chat_metadata?.chat_world_info,
        document.querySelector('.chat_world_info_selector')?.value,
    ];
    for (const value of candidates) addWorldRef(refs, value, '当前聊天世界书');
    return refs;
}

function collectPersonaWorldRefs() {
    const refs = new Map();
    const candidates = [
        globalThis.power_user?.persona_lorebook,
        globalThis.power_user?.personaLorebook,
        globalThis.power_user?.persona_world_info,
        globalThis.power_user?.persona_world,
    ];
    for (const value of candidates) addWorldRef(refs, value, '当前 Persona 世界书');
    const selector = document.querySelector('[data-persona-lorebook], .persona_lorebook_selector');
    addWorldRef(refs, selector?.value, '当前 Persona 世界书');
    return refs;
}

function mergeWorldRefs(target, source) {
    for (const [key, values] of source) {
        const list = target.get(key) || [];
        for (const value of values) if (!list.includes(value)) list.push(value);
        target.set(key, list);
    }
}

async function scanEmbeddedWorlds(characters, progress) {
    const worlds = await listWorlds();
    const provenance = await updateWorldProvenance(characters, worlds);
    const liveRefs = collectCharacterWorldRefs(characters);
    try {
        mergeWorldRefs(liveRefs, collectGlobalWorldRefs(await stPostJson('/api/settings/get', {})));
    } catch {
    }
    mergeWorldRefs(liveRefs, collectCurrentChatWorldRef());
    mergeWorldRefs(liveRefs, collectPersonaWorldRefs());
    const candidates = [], errors = [];
    for (let i = 0; i < worlds.length; i++) {
        const item = worlds[i] || {};
        const fileId = normalizeWorldId(item.file_id ?? item.name);
        const displayName = String(item.name || fileId);
        if (!fileId) continue;
        progress?.(`扫描世界书 ${i + 1}/${worlds.length}…`);
        try {
            const data = extractWorldData(await getWorld(fileId));
            const original = getOriginalCharacterBook(data);
            const history = provenance[fileId];
            if (!original && !history) continue;
            const refs = liveRefs.get(fileId) || liveRefs.get(normalizeWorldId(displayName)) || [];
            if (refs.length) continue;
            const entries = original?.entries
                ? (Array.isArray(original.entries) ? original.entries.length : Object.keys(original.entries || {}).length)
                : 0;
            candidates.push({
                worldId: fileId,
                fileId,
                name: displayName,
                entries,
                sourceName: String(original?.name || history?.sourceBookName || ''),
                sourceCharacter: String(history?.sourceCharacter || ''),
                provenance: original ? '角色卡 Character Book（originalData）' : '工具历史来源记录',
                confidence: original ? 'high' : 'medium',
            });
        } catch (error) {
            errors.push({ fileId, error });
        }
    }
    return { total: worlds.length, candidates, errors };
}

async function scanOldChats(days, characters, progress) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const candidates = [], errors = [], seen = new Set();
    for (let i = 0; i < characters.length; i++) {
        const character = characters[i] || {}, avatar = character.avatar;
        if (!avatar) continue;
        progress?.(`扫描聊天 ${i + 1}/${characters.length}…`);
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
                const time = parseChatTimestamp(chat.date_last_chat ?? chat.last_mes ?? chat.last_message ?? chat.updatedAt);
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

function formatDate(timestamp) {
    return new Date(timestamp).toLocaleString();
}

async function scanWebCaches() {
    if (!('caches' in globalThis)) return { supported: false, caches: [] };
    const names = await caches.keys();
    const result = [];
    for (const name of names) {
        let entries = [];
        try {
            entries = await (await caches.open(name)).keys();
        } catch {
        }
        result.push({ name, cacheId: name, entries: entries.length });
    }
    return { supported: true, caches: result };
}

async function scanBrowserStorage() {
    const result = { localStorage: [], sessionStorage: [], indexedDB: [] };
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key) result.localStorage.push({ id: key, bytes: String(localStorage.getItem(key) || '').length });
        }
    } catch {
    }
    try {
        for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            if (key) result.sessionStorage.push({ id: key, bytes: String(sessionStorage.getItem(key) || '').length });
        }
    } catch {
    }
    try {
        if (typeof globalThis.indexedDB?.databases === 'function') {
            const dbs = await globalThis.indexedDB.databases();
            result.indexedDB = (dbs || []).filter(db => db?.name).map(db => ({ id: db.name, version: db.version || 0 }));
        }
    } catch {
    }
    return result;
}

async function discoverHostCleanup() {
    const host = getHost();
    return {
        nativePicker: typeof host?.api?.characterCards?.pickFiles === 'function',
        publicAbi: Boolean(host?.api),
    };
}

async function scanTauriNativeStorage() {
    const tauri = globalThis.__TAURI__;
    const pathApi = tauri?.path;
    const fsApi = tauri?.fs;
    const result = { supported: Boolean(pathApi && (fsApi?.readDir || getNativeFsApi())), temp: [], appCache: [], errors: [] };
    if (!result.supported) return result;
    const targets = [
        ['temp', pathApi.tempDir],
        ['appCache', pathApi.appCacheDir],
    ];
    for (const [kind, getPath] of targets) {
        if (typeof getPath !== 'function') continue;
        try {
            const directory = await getPath();
            const entries = await nativeReadDir(directory);
            result[kind] = (entries || []).map(entry => ({
                name: String(entry?.name || ''),
                path: String(entry?.path || `${directory}/${entry?.name || ''}`),
                type: entry?.isDirectory ? 'directory' : entry?.isFile ? 'file' : 'other',
            })).filter(entry => entry.name);
        } catch (error) {
            result.errors.push({ kind, error });
        }
    }
    return result;
}

async function clearSelectedNative(selected) {
    let deleted = 0, failures = 0;
    for (const item of selected) {
        try {
            await nativeRemove(item.path);
            deleted++;
        } catch {
            failures++;
        }
    }
    return { deleted, failures };
}

async function clearSelectedWorlds(selected) {
    let deleted = 0, failures = 0;
    for (const item of selected) {
        try {
            const response = await stFetch('/api/worldinfo/delete', { method: 'POST', body: JSON.stringify({ name: normalizeWorldId(item) }) });
            if (response.ok) deleted++; else failures++;
        } catch {
            failures++;
        }
    }
    return { deleted, failures };
}

async function clearSelectedChats(selected) {
    let deleted = 0, failures = 0;
    for (const item of selected) {
        try {
            const response = await stFetch('/api/chats/delete', { method: 'POST', body: JSON.stringify({ chatfile: `${item.fileName}.jsonl`, avatar_url: item.avatar }) });
            if (response.ok) deleted++; else failures++;
        } catch {
            failures++;
        }
    }
    return { deleted, failures };
}

function renderNativeReadOnlyGroup(box, title, rows, kind) {
    const details = document.createElement('details');
    details.open = true;
    details.className = 'xztb-clean-group';
    const head = document.createElement('div');
    head.className = 'xztb-row xztb-native-head';
    const summaryEl = document.createElement('span');
    summaryEl.className = 'xztb-clean-summary';
    summaryEl.textContent = `${title}（${rows.length}）`;
    head.appendChild(summaryEl);
    if (kind === 'temp' && rows.length) {
        const noteButton = document.createElement('button');
        noteButton.type = 'button';
        noteButton.className = 'menu_button';
        noteButton.textContent = '全选';
        noteButton.disabled = true;
        noteButton.title = '系统临时目录可能包含其他程序或当前进程正在使用的文件，因此本版不提供批量删除。';
        head.appendChild(noteButton);
    }
    details.appendChild(head);
    const note = document.createElement('div');
    note.className = 'xztb-note';
    note.textContent = kind === 'temp'
        ? '这里是系统临时目录，不等同于酒馆专属临时目录。为避免误删其他程序或当前进程文件，本版只扫描，不提供删除。'
        : '应用缓存目录可能包含程序运行所需的可重建缓存或运行期资源，本版只扫描，不提供删除。';
    details.appendChild(note);
    if (rows.length) {
        const list = document.createElement('div');
        list.className = 'xztb-list';
        rows.forEach(item => {
            const div = document.createElement('div');
            div.className = 'xztb-check-row';
            div.textContent = `${item.name}${item.type === 'directory' ? '（目录）' : '（文件）'}`;
            const small = document.createElement('small');
            small.textContent = item.path;
            div.appendChild(small);
            list.appendChild(div);
        });
        details.appendChild(list);
    } else {
        const empty = document.createElement('div');
        empty.className = 'xztb-note';
        empty.textContent = '没有发现顶层项目。';
        details.appendChild(empty);
    }
    box.appendChild(details);
}

function renderCleanResults(root, state) {
    const box = root.querySelector('[data-clean-results]');
    box.innerHTML = '';
    const safeTotal = state.worldCandidates.length + state.chatCandidates.filter(r => !r.current).length + state.webCaches.length;
    const summary = document.createElement('div');
    summary.className = 'xztb-summary';
    summary.textContent = `扫描完成：发现 ${safeTotal} 项可处理内容（世界书 ${state.worldCandidates.length}、旧聊天 ${state.chatCandidates.length}、Cache Storage ${state.webCaches.length}；原生临时/缓存仅扫描 ${state.nativeStorage.temp.length + state.nativeStorage.appCache.length}）。`;
    box.appendChild(summary);
    const renderGroup = (title, rows, key, detailFn, disabledFn = () => false) => {
        const details = document.createElement('details');
        details.open = rows.length > 0;
        details.className = 'xztb-clean-group';
        const summaryEl = document.createElement('summary');
        const summaryTitle = document.createElement('span');
        summaryTitle.textContent = `${title}（${rows.length}）`;
        summaryEl.appendChild(summaryTitle);
        if (rows.length) {
            const summaryAll = document.createElement('button');
            summaryAll.type = 'button';
            summaryAll.className = 'menu_button';
            summaryAll.textContent = '全选';
            summaryAll.title = '无需展开列表即可全选或取消全选';
            summaryAll.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                const inputs = [...list.querySelectorAll('input:not(:disabled)')];
                const shouldSelect = inputs.some(input => !input.checked);
                inputs.forEach(input => input.checked = shouldSelect);
                summaryAll.textContent = shouldSelect ? '取消全选' : '全选';
            });
            summaryEl.appendChild(summaryAll);
        }
        details.appendChild(summaryEl);
        if (!rows.length) {
            const empty = document.createElement('div');
            empty.className = 'xztb-note';
            empty.textContent = '没有发现。';
            details.appendChild(empty);
            box.appendChild(details);
            return;
        }
        const actions = document.createElement('div');
        actions.className = 'xztb-row';
        const clear = document.createElement('button');
        clear.type = 'button';
        clear.className = 'menu_button';
        clear.textContent = '清理选中';
        clear.dataset.cleanAction = key;
        actions.appendChild(clear);
        box.appendChild(details);
        details.appendChild(actions);
        const list = document.createElement('div');
        list.className = 'xztb-list';
        for (const rowData of rows) {
            const label = document.createElement('label');
            label.className = 'xztb-check-row';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.disabled = disabledFn(rowData);
            input.dataset[key] = '1';
            input.value = rowData[key] ?? rowData.name ?? rowData.id ?? '';
            const text = document.createElement('span');
            const titleEl = document.createElement('b');
            titleEl.textContent = rowData.name || rowData.fileName || rowData.characterName || rowData.id;
            const small = document.createElement('small');
            small.textContent = detailFn(rowData);
            text.append(titleEl, small);
            label.append(input, text);
            list.appendChild(label);
        }
        details.appendChild(list);
        const summaryButton = summaryEl.querySelector('button');
        if (summaryButton) summaryButton.textContent = [...list.querySelectorAll('input:not(:disabled)')].every(input => input.checked) ? '取消全选' : '全选';
        box.appendChild(details);
    };
    renderGroup('🌍 角色卡导入后遗留世界书', state.worldCandidates, 'worldId', r => `${r.provenance}${r.sourceCharacter ? `；原角色：${r.sourceCharacter}` : ''}${r.sourceName ? `；Character Book：${r.sourceName}` : ''}；${r.entries} 个条目；当前没有活动引用`);
    renderGroup('🗨️ 超过设定天数未使用的聊天', state.chatCandidates, 'chatId', r => `${formatDate(r.time)}；角色：${r.characterName}${r.current ? '；当前聊天，不允许删除' : ''}`, r => r.current);
    renderGroup('🌐 浏览器 Cache Storage', state.webCaches, 'cacheId', r => `${r.entries} 个缓存请求；删除后资源可能重新缓存`);
    renderNativeReadOnlyGroup(box, '🧺 原生临时目录', state.nativeStorage.temp, 'temp');
    renderNativeReadOnlyGroup(box, '📦 原生应用缓存', state.nativeStorage.appCache, 'appCache');
    const idb = document.createElement('details');
    idb.className = 'xztb-clean-group';
    const idbSummary = document.createElement('summary');
    idbSummary.textContent = `🗄️ IndexedDB 数据库（${state.browserStorage.indexedDB.length}）`;
    idb.appendChild(idbSummary);
    const idbNote = document.createElement('div');
    idbNote.className = 'xztb-note';
    idbNote.textContent = state.browserStorage.indexedDB.length ? '已列出浏览器数据库名称与版本。IndexedDB 可能包含角色、聊天、扩展数据，本版只扫描，不提供一键删除。' : '没有发现浏览器 IndexedDB 数据库。';
    idb.appendChild(idbNote);
    if (state.browserStorage.indexedDB.length) {
        const list = document.createElement('div');
        list.className = 'xztb-list';
        state.browserStorage.indexedDB.forEach(r => {
            const div = document.createElement('div');
            div.className = 'xztb-check-row';
            div.textContent = `${r.name}（版本 ${r.version}）`;
            list.appendChild(div);
        });
        idb.appendChild(list);
    }
    box.appendChild(idb);
    const native = document.createElement('details');
    native.className = 'xztb-clean-group';
    native.open = true;
    const ns = document.createElement('summary');
    ns.textContent = `🧹 原生临时 / 应用缓存（${state.nativeStorage.temp.length + state.nativeStorage.appCache.length}）`;
    native.appendChild(ns);
    const nn = document.createElement('div');
    nn.className = 'xztb-note';
    if (!state.nativeStorage.supported) nn.textContent = '当前没有公开可用的 Tauri 文件系统对象，因此无法安全枚举宿主临时目录或应用缓存目录。';
    else if (!state.nativeStorage.temp.length && !state.nativeStorage.appCache.length) nn.textContent = '已访问可用的原生目录，没有发现顶层项目。';
    else nn.textContent = '已扫描 Tauri 暴露的临时目录与应用缓存目录；选中项目可直接删除。';
    native.appendChild(nn);
    const nativeRows = [...state.nativeStorage.temp.map(item => ({ ...item, scope: 'temp' })), ...state.nativeStorage.appCache.map(item => ({ ...item, scope: 'appCache' }))];
    if (nativeRows.length) {
        const list = document.createElement('div');
        list.className = 'xztb-list';
        nativeRows.forEach(item => {
            const div = document.createElement('div');
            div.className = 'xztb-check-row';
            div.textContent = `${item.scope === 'temp' ? '临时目录' : '应用缓存'}：${item.name}${item.type === 'directory' ? '（目录）' : '（文件）'}`;
            list.appendChild(div);
        });
        native.appendChild(list);
    }
    box.appendChild(native);
    const storage = document.createElement('details');
    storage.className = 'xztb-clean-group';
    const storageSummary = document.createElement('summary');
    storageSummary.textContent = `💾 浏览器存储（Local ${state.browserStorage.localStorage.length} / Session ${state.browserStorage.sessionStorage.length}）`;
    storage.appendChild(storageSummary);
    const storageNote = document.createElement('div');
    storageNote.className = 'xztb-note';
    storageNote.textContent = 'LocalStorage / SessionStorage 可能包含角色、设置、扩展数据，不自动删除。';
    storage.appendChild(storageNote);
    box.appendChild(storage);
    if (state.extensionCandidates.length) {
        const ext = document.createElement('details');
        ext.className = 'xztb-clean-group';
        ext.open = true;
        const es = document.createElement('summary');
        es.textContent = `🧩 可疑扩展设置残留（${state.extensionCandidates.length}）`;
        ext.appendChild(es);
        const list = document.createElement('div');
        list.className = 'xztb-list';
        state.extensionCandidates.forEach(r => {
            const div = document.createElement('div');
            div.className = 'xztb-check-row';
            div.innerHTML = `<span><b>${escapeHtml(r.id)}</b><small>${escapeHtml(r.note)}</small></span>`;
            list.appendChild(div);
        });
        ext.appendChild(list);
        box.appendChild(ext);
    }
    if (state.errors.length) {
        const error = document.createElement('div');
        error.className = 'xztb-note';
        error.textContent = `有 ${state.errors.length} 个扫描子项失败，失败项不会加入清理。`;
        box.appendChild(error);
    }
}

async function scanLocalTempAndExtensionHints() {
    const extensionIds = new Set();
    const extensionsRoot = document.querySelector('#extensions_settings2, #extensions_settings');
    extensionsRoot?.querySelectorAll('[data-extension-id], [id^="extension_"]').forEach(el => {
        const id = el.getAttribute('data-extension-id') || el.id.replace(/^extension_/, '');
        if (id) extensionIds.add(id);
    });
    const settings = globalThis.extension_settings && typeof globalThis.extension_settings === 'object' ? globalThis.extension_settings : null;
    const storageCandidates = [];
    if (settings) {
        for (const key of Object.keys(settings)) {
            if (!extensionIds.has(key)) storageCandidates.push({ id: key, kind: 'extension_settings', note: '存在扩展设置数据，但当前页面未发现同名扩展 UI；仅提示，不自动删除。' });
        }
    }
    return { extensionIds: [...extensionIds], settingsCandidates: storageCandidates };
}

async function scanAllCleanup(root) {
    const status = root.querySelector('[data-clean-status]');
    status.textContent = '正在全面扫描…';
    root.querySelector('[data-clean-results]').innerHTML = '';
    const state = { worldCandidates: [], chatCandidates: [], webCaches: [], extensionCandidates: [], browserStorage: { localStorage: [], sessionStorage: [], indexedDB: [] }, nativeStorage: { supported: false, temp: [], appCache: [], errors: [] }, host: {}, errors: [] };
    try {
        const characters = await getCharacters();
        const [worldResult, chatResult, webResult, hostResult, extResult, storageResult, nativeResult] = await Promise.allSettled([
            scanEmbeddedWorlds(characters, s => status.textContent = s),
            scanOldChats(Number(root.querySelector('[data-chat-days]').value) || 15, characters, s => status.textContent = s),
            scanWebCaches(),
            discoverHostCleanup(),
            scanLocalTempAndExtensionHints(),
            scanBrowserStorage(),
            scanTauriNativeStorage(),
        ]);
        if (worldResult.status === 'fulfilled') state.worldCandidates = worldResult.value.candidates; else state.errors.push(worldResult.reason);
        if (worldResult.status === 'fulfilled') state.errors.push(...worldResult.value.errors);
        if (chatResult.status === 'fulfilled') { state.chatCandidates = chatResult.value.candidates; state.errors.push(...chatResult.value.errors); } else state.errors.push(chatResult.reason);
        if (webResult.status === 'fulfilled') state.webCaches = webResult.value.caches; else state.errors.push(webResult.reason);
        if (hostResult.status === 'fulfilled') state.host = hostResult.value; else state.errors.push(hostResult.reason);
        if (extResult.status === 'fulfilled') state.extensionCandidates = extResult.value.settingsCandidates; else state.errors.push(extResult.reason);
        if (storageResult.status === 'fulfilled') state.browserStorage = storageResult.value; else state.errors.push(storageResult.reason);
        if (nativeResult.status === 'fulfilled') { state.nativeStorage = nativeResult.value; state.errors.push(...nativeResult.value.errors); } else state.errors.push(nativeResult.reason);
        root.__xztbCleanState = state;
        renderCleanResults(root, state);
        status.textContent = `全面扫描完成：世界书 ${state.worldCandidates.length}，旧聊天 ${state.chatCandidates.length}，Cache Storage ${state.webCaches.length}，IndexedDB ${state.browserStorage.indexedDB.length}，原生临时/缓存扫描 ${state.nativeStorage.temp.length + state.nativeStorage.appCache.length}。`;
    } catch (error) {
        console.error('[小众工具箱] 清理扫描失败:', error);
        status.textContent = `扫描失败：${error?.message || error}`;
    }
}

async function handleCleanAction(root, key) {
    const list = root.querySelectorAll(`input[data-${key}]:checked`);
    if (!list.length) return;
    if (!confirm(`确定清理选中的 ${list.length} 项吗？当前操作会直接调用删除接口。`)) return;
    try {
        let message = '';
        if (key === 'worldId') {
            const result = await clearSelectedWorlds([...list].map(x => x.value));
            message = `已删除世界书 ${result.deleted} 个${result.failures ? `，失败 ${result.failures} 个` : ''}。`;
        } else if (key === 'chatId') {
            const items = [...list].map(x => root.__xztbCleanState.chatCandidates.find(r => r.chatId === x.value)).filter(Boolean);
            const result = await clearSelectedChats(items);
            message = `已删除聊天 ${result.deleted} 个${result.failures ? `，失败 ${result.failures} 个` : ''}。`;
        } else if (key === 'cacheId') {
            let deleted = 0, failures = 0;
            for (const name of [...list].map(x => x.value)) {
                try {
                    if (await caches.delete(name)) deleted++; else failures++;
                } catch {
                    failures++;
                }
            }
            message = `已删除 Cache Storage ${deleted} 个${failures ? `，失败 ${failures} 个` : ''}。`;
        }
        root.querySelector('[data-clean-status]').textContent = message;
        await scanAllCleanup(root);
    } catch (error) {
        root.querySelector('[data-clean-status]').textContent = `清理失败：${error?.message || error}`;
    }
}

function isZipHeader(header) {
    return header.length === 4 && header[0] === 0x50 && header[1] === 0x4b && (header[2] === 0x03 || header[2] === 0x05 || header[2] === 0x07) && (header[3] === 0x04 || header[3] === 0x06 || header[3] === 0x08);
}

function findZipEnd(bytes) {
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
        if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) return i;
    }
    return -1;
}

async function readZipEntries(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const end = findZipEnd(bytes);
    if (end < 0) throw new Error('无法读取 ZIP 中央目录。');
    const view = new DataView(bytes.buffer);
    const cdSize = view.getUint32(end + 12, true), cdOffset = view.getUint32(end + 16, true);
    const decoder = new TextDecoder();
    const entries = [];
    let offset = cdOffset;
    while (offset < cdOffset + cdSize) {
        if (offset + 46 > bytes.length || view.getUint32(offset, false) !== 0x504b0102) break;
        const method = view.getUint16(offset + 10, true);
        const compressedSize = view.getUint32(offset + 20, true);
        const nameLength = view.getUint16(offset + 28, true);
        const extraLength = view.getUint16(offset + 30, true);
        const commentLength = view.getUint16(offset + 32, true);
        const localOffset = view.getUint32(offset + 42, true);
        const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength)).replace(/^\.\//, '');
        entries.push({ name, method, compressedSize, localOffset });
        offset += 46 + nameLength + extraLength + commentLength;
    }
    return { bytes, entries };
}

async function readZipText(file, wantedPath) {
    const { bytes, entries } = await readZipEntries(file);
    const view = new DataView(bytes.buffer);
    const decoder = new TextDecoder();
    const wanted = wantedPath.replace(/^\.\//, '');
    const entry = entries.find(item => item.name === wanted);
    if (!entry) return null;
    const { localOffset, compressedSize, method } = entry;
    if (view.getUint32(localOffset, false) !== 0x504b0304) throw new Error('ZIP 本地文件头异常。');
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);
    let raw;
    if (method === 0) raw = compressed;
    else if (method === 8 && globalThis.DecompressionStream) raw = new Uint8Array(await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    else throw new Error(`不支持 ZIP 压缩方法 ${method}。`);
    return decoder.decode(raw);
}

async function findZipManifest(file) {
    const { entries } = await readZipEntries(file);
    const candidates = entries.filter(item => {
        if (item.name.endsWith('/')) return false;
        const parts = item.name.split('/');
        return parts[parts.length - 1].toLowerCase() === 'manifest.json' && parts.length <= 2;
    });
    if (!candidates.length) return null;
    const preferred = candidates.find(item => item.name === 'manifest.json') || candidates[0];
    return { path: preferred.name, root: preferred.name.includes('/') ? preferred.name.split('/')[0] : '' };
}

function normalizeExtensionVersion(value) {
    const text = String(value ?? '').trim().replace(/^v/i, '');
    const match = text.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/);
    if (!match) return null;
    return [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)];
}

function compareVersions(a, b) {
    const av = normalizeExtensionVersion(a), bv = normalizeExtensionVersion(b);
    if (!av || !bv) return null;
    for (let i = 0; i < 3; i++) if (av[i] !== bv[i]) return av[i] > bv[i] ? 1 : -1;
    return 0;
}

async function discoverInstalledExtensions() {
    const result = new Map();
    try {
        const response = await stFetch('/api/extensions/discover');
        if (!response.ok) return result;
        const names = await response.json();
        if (!Array.isArray(names)) return result;
        for (const entry of names) {
            const rawName = typeof entry === 'string' ? entry : entry?.name;
            const type = typeof entry === 'object' ? entry?.type : undefined;
            const safeName = String(rawName || '').replace(/^third-party[\\/]?/, '').replace(/^local[\\/]?/, '').replace(/^global[\\/]?/, '');
            if (!safeName) continue;
            try {
                const manifestResponse = await stFetch(`/scripts/extensions/third-party/${encodeURIComponent(safeName)}/manifest.json`);
                if (!manifestResponse.ok) continue;
                const manifest = await manifestResponse.json();
                result.set(safeName, { ...manifest, name: safeName, type });
            } catch {
            }
        }
    } catch {
    }
    return result;
}

async function getZipManifest(file) {
    const info = await findZipManifest(file);
    if (!info) return null;
    const text = await readZipText(file, info.path);
    return text ? { text, root: info.root } : null;
}

async function inspectZip(file, status, actions, metaContainer) {
    const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    if (!isZipHeader(header)) throw new Error('这个文件不是有效的 ZIP 文件。');
    const manifestFile = await getZipManifest(file);
    if (!manifestFile) throw new Error('ZIP 中找不到顶层 manifest.json，无法识别为 SillyTavern/TauriTavern 扩展。');
    let manifest;
    try {
        manifest = JSON.parse(manifestFile.text);
    } catch {
        throw new Error('manifest.json 解析失败。');
    }
    if (!manifest || typeof manifest !== 'object' || !manifest.version || !manifest.js) throw new Error('manifest.json 缺少 version 或 js 字段。');
    const candidates = [manifest.name, manifestFile.root, file.name.replace(/\.zip$/i, ''), manifest.display_name].filter(Boolean).map(String);
    const extensionName = candidates.find(name => /^[A-Za-z0-9_.-]+$/.test(name)) || candidates[0];
    const installed = await discoverInstalledExtensions();
    const installedEntry = installed.get(extensionName) || [...installed.entries()].find(([name, item]) => item.display_name === manifest.display_name)?.[1];
    actions.innerHTML = '';
    const replaceMode = installedEntry ? 'replace' : 'install';
    const comparison = installedEntry ? compareVersions(manifest.version, installedEntry.version) : null;
    metaContainer.textContent = installedEntry
        ? `扩展：${manifest.display_name || extensionName}；本机 ${installedEntry.version || '未知'}；ZIP ${manifest.version}${comparison === 1 ? '（可升级）' : comparison === 0 ? '（相同版本）' : comparison === -1 ? '（ZIP 版本较旧）' : ''}。`
        : `扩展：${manifest.display_name || extensionName}；版本 ${manifest.version}；未发现同名已安装扩展。`;
    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.className = 'menu_button';
    confirmButton.textContent = installedEntry ? '确认替换 / 升级' : '确认导入';
    confirmButton.addEventListener('click', () => installZipViaLocal(file, manifest, extensionName, status, comparison, installedEntry));
    actions.appendChild(confirmButton);
    return { manifest, extensionName, installedEntry, comparison, replaceMode };
}

function getTauriGlobals() {
    const tauri = globalThis.__TAURI__;
    const internals = globalThis.__TAURI_INTERNALS__;
    return { tauri, internals };
}

async function tauriInvoke(command, args) {
    const host = getHost();
    if (typeof host?.invoke?.safeInvoke === 'function') return host.invoke.safeInvoke(command, args);
    const { internals } = getTauriGlobals();
    if (typeof internals?.invoke !== 'function') throw new Error('当前 WebView 没有 Tauri invoke。');
    return internals.invoke(command, args);
}

function getNativeFsApi() {
    const { tauri } = getTauriGlobals();
    return tauri?.fs || null;
}

function getNativeDialogApi() {
    const { tauri } = getTauriGlobals();
    return tauri?.dialog || null;
}

async function nativeReadDir(path) {
    const fs = getNativeFsApi();
    if (typeof fs?.readDir === 'function') return fs.readDir(path);
    return tauriInvoke('plugin:fs|read_dir', { path });
}
async function nativeReadFile(path) {
    const fs = getNativeFsApi();
    if (typeof fs?.readFile === 'function') return fs.readFile(path);
    return new Uint8Array(await tauriInvoke('plugin:fs|read_file', { path }));
}

async function nativeExists(path) {
    const fs = getNativeFsApi();
    if (typeof fs?.exists === 'function') return fs.exists(path);
    try {
        await tauriInvoke('plugin:fs|stat', { path });
        return true;
    } catch {
        return false;
    }
}

async function nativeMkdir(path) {
    const fs = getNativeFsApi();
    if (typeof fs?.mkdir === 'function') return fs.mkdir(path, { recursive: true });
    return tauriInvoke('plugin:fs|mkdir', { path, options: { recursive: true } });
}

async function nativeWriteFile(path, contents) {
    const fs = getNativeFsApi();
    if (typeof fs?.writeFile === 'function') return fs.writeFile(path, contents);
    return tauriInvoke('plugin:fs|write_file', { path, contents: Array.from(contents) });
}

async function nativeRemove(path) {
    const fs = getNativeFsApi();
    if (typeof fs?.remove === 'function') return fs.remove(path, { recursive: true });
    return tauriInvoke('plugin:fs|remove', { path, options: { recursive: true } });
}

async function nativeRename(oldPath, newPath) {
    const fs = getNativeFsApi();
    if (typeof fs?.rename === 'function') return fs.rename(oldPath, newPath);
    return tauriInvoke('plugin:fs|rename', { oldPath, newPath });
}

function joinNativePath(...parts) {
    let result = '';
    for (const part of parts) {
        const value = String(part ?? '').replace(/^[/\\]+|[/\\]+$/g, '');
        if (!value) continue;
        if (!result) result = String(part ?? '').replace(/[\\/]+$/, '');
        else result += `/${value}`;
    }
    return result;
}

function sanitizeExtensionFolder(value) {
    const text = String(value || '').trim().replace(/\\/g, '/');
    const base = text.split('/').filter(Boolean).pop() || 'extension';
    const clean = base.replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^\.+$/, 'extension');
    if (!clean || clean === '.' || clean === '..') return 'extension';
    return clean;
}

async function chooseExtensionsRoot() {
    const dialog = getNativeDialogApi();
    if (typeof dialog?.open === 'function') {
        const selected = await dialog.open({ directory: true, multiple: false, title: '选择 TauriTavern data 目录' });
        if (typeof selected === 'string' && selected) {
            localStorage.setItem('xiaozhong_toolbox_extensions_root_v2', selected);
            return { kind: 'native', path: selected };
        }
        return null;
    }
    if (typeof globalThis.showDirectoryPicker === 'function') {
        const handle = await globalThis.showDirectoryPicker({ mode: 'readwrite', id: `${EXT_ID}-data-root` });
        return { kind: 'handle', handle };
    }
    const remembered = localStorage.getItem('xiaozhong_toolbox_extensions_root_v2');
    return remembered ? { kind: 'native', path: remembered } : null;
}

function looksLikeDataRoot(entries) {
    const names = new Set((entries || []).map(entry => String(entry?.name || '').toLowerCase()));
    return names.has('default-user') || names.has('extensions') || names.has('characters');
}

async function verifyNativeDataRoot(rootPath) {
    const entries = await nativeReadDir(rootPath);
    if (!looksLikeDataRoot(entries)) throw new Error('所选目录不像 TauriTavern data 目录，请选择包含 default-user 或 extensions 的 data 目录。');
    return true;
}

async function resolveInstalledTarget(installedEntry, defaultMode = 'local') {
    const remembered = localStorage.getItem('xiaozhong_toolbox_extensions_root_v2');
    let root = remembered ? { kind: 'native', path: remembered } : null;
    if (root?.kind === 'native') {
        try {
            await verifyNativeDataRoot(root.path);
        } catch {
            root = null;
        }
    }
    if (!root) root = await chooseExtensionsRoot();
    if (!root) return null;
    const globalInstall = defaultMode === 'global' || installedEntry?.type === 'global';
    if (root.kind === 'native') {
        await verifyNativeDataRoot(root.path);
        const base = globalInstall
            ? joinNativePath(root.path, 'extensions', 'third-party')
            : joinNativePath(root.path, 'default-user', 'extensions', 'third-party');
        await nativeMkdir(base);
        return { kind: 'native', base, mode: globalInstall ? 'global' : 'local' };
    }
    let dataHandle = root.handle;
    const extensionHandle = await dataHandle.getDirectoryHandle('extensions', { create: true });
    let baseHandle;
    if (globalInstall) {
        baseHandle = await extensionHandle.getDirectoryHandle('third-party', { create: true });
    } else {
        const defaultUser = await dataHandle.getDirectoryHandle('default-user', { create: true });
        const localExt = await defaultUser.getDirectoryHandle('extensions', { create: true });
        baseHandle = await localExt.getDirectoryHandle('third-party', { create: true });
    }
    return { kind: 'handle', baseHandle, mode: globalInstall ? 'global' : 'local' };
}

async function getNativeZipFiles(file) {
    const { bytes, entries } = await readZipEntries(file);
    const view = new DataView(bytes.buffer);
    const decoder = new TextDecoder();
    const files = [];
    for (const entry of entries) {
        if (!entry.name || entry.name.endsWith('/')) continue;
        const normalized = entry.name.replace(/^\.\//, '').replace(/\\/g, '/');
        const parts = normalized.split('/');
        if (parts.some(part => !part || part === '.' || part === '..')) throw new Error(`ZIP 含非法路径：${entry.name}`);
        const localOffset = entry.localOffset;
        if (view.getUint32(localOffset, false) !== 0x504b0304) throw new Error(`ZIP 本地文件头异常：${entry.name}`);
        const localNameLength = view.getUint16(localOffset + 26, true);
        const localExtraLength = view.getUint16(localOffset + 28, true);
        const dataStart = localOffset + 30 + localNameLength + localExtraLength;
        const compressed = bytes.slice(dataStart, dataStart + entry.compressedSize);
        let raw;
        if (entry.method === 0) raw = compressed;
        else if (entry.method === 8 && globalThis.DecompressionStream) raw = new Uint8Array(await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
        else throw new Error(`不支持 ZIP 压缩方法 ${entry.method}：${entry.name}`);
        files.push({ path: normalized, bytes: raw });
    }
    return files;
}

function stripArchiveRoot(files, root) {
    if (!root) return files;
    const prefix = `${root.replace(/\/$/, '')}/`;
    const matches = files.every(file => file.path === root || file.path.startsWith(prefix));
    if (!matches) return files;
    return files.filter(file => file.path !== root).map(file => ({ ...file, path: file.path.slice(prefix.length) })).filter(file => file.path);
}

async function writeDirectoryHandle(handle, parts, bytes) {
    let current = handle;
    for (const part of parts.slice(0, -1)) current = await current.getDirectoryHandle(part, { create: true });
    const fileHandle = await current.getFileHandle(parts[parts.length - 1], { create: true });
    const writer = await fileHandle.createWritable();
    try {
        await writer.write(bytes);
        await writer.close();
    } catch (error) {
        try { await writer.abort(); } catch {}
        throw error;
    }
}

async function removeDirectoryHandle(handle) {
    const names = [];
    for await (const name of handle.keys()) names.push(name);
    for (const name of names) {
        const child = await handle.getFileHandle(name).catch(() => null);
        if (child) continue;
        const dir = await handle.getDirectoryHandle(name);
        await removeDirectoryHandle(dir);
        await handle.removeEntry(name, { recursive: true });
    }
    for (const name of names) {
        try { await handle.removeEntry(name, { recursive: true }); } catch {
        }
    }
}

async function installZipToNativeRoot(file, manifest, extensionName, installedEntry, mode) {
    const target = await resolveInstalledTarget(installedEntry, mode);
    if (!target) return { cancelled: true };
    const zipInfo = await findZipManifest(file);
    const files = stripArchiveRoot(await getNativeZipFiles(file), zipInfo?.root || '');
    const manifestEntry = files.find(item => item.path.toLowerCase() === 'manifest.json');
    if (!manifestEntry) throw new Error('ZIP 目录整理失败：解压后找不到根 manifest.json。');
    const folder = sanitizeExtensionFolder(extensionName);
    const stamp = `${Date.now()}`;
    if (target.kind === 'native') {
        const dest = joinNativePath(target.base, folder);
        const backup = joinNativePath(target.base, `.${folder}.backup-${stamp}`);
        const existed = await nativeExists(dest);
        if (existed) await nativeRename(dest, backup);
        try {
            await nativeMkdir(dest);
            for (const item of files) {
                const parts = item.path.split('/');
                if (parts.some(part => !part || part === '.' || part === '..')) throw new Error(`非法 ZIP 路径：${item.path}`);
                const parent = joinNativePath(dest, ...parts.slice(0, -1));
                if (parts.length > 1) await nativeMkdir(parent);
                await nativeWriteFile(joinNativePath(dest, ...parts), item.bytes);
            }
            await nativeWriteFile(joinNativePath(dest, 'manifest.json'), manifestEntry.bytes);
            if (existed) await nativeRemove(backup);
        } catch (error) {
            try { await nativeRemove(dest); } catch {}
            if (existed) {
                try { await nativeRename(backup, dest); } catch {}
            }
            throw error;
        }
        return { installed: true, mode: target.mode, path: dest, fileCount: files.length };
    }
    const exists = await target.baseHandle.getDirectoryHandle(folder).then(() => true).catch(() => false);
    if (exists) await target.baseHandle.removeEntry(folder, { recursive: true });
    const dest = await target.baseHandle.getDirectoryHandle(folder, { create: true });
    for (const item of files) await writeDirectoryHandle(dest, item.path.split('/'), item.bytes);
    return { installed: true, mode: target.mode, fileCount: files.length };
}

async function installZipViaLocal(file, manifest, extensionName, status, comparison, installedEntry) {
    const mode = installedEntry?.type === 'global' ? 'global' : 'local';
    try {
        const result = await installZipToNativeRoot(file, manifest, extensionName, installedEntry, mode);
        if (result.cancelled) {
            status.textContent = '已取消扩展安装。';
            return;
        }
        status.textContent = `${result.mode === 'global' ? '全局' : '本地'}扩展已${installedEntry ? '替换' : '安装'}：${manifest.display_name || extensionName} ${manifest.version}。已写入 ${result.fileCount} 个文件。请刷新 TauriTavern 扩展列表。`;
    } catch (error) {
        status.textContent = `扩展安装失败：${error?.message || error}`;
    }
}

async function openNativeGenericPicker(accept, title) {
    const host = getHost();
    const picker = host?.api?.characterCards;
    if (accept === 'json' && picker?.pickFiles && (await picker.isNativePickerAvailable?.())) return picker.pickFiles({ multiple: false, title });
    const { tauri } = getTauriGlobals();
    if (typeof tauri?.dialog?.open === 'function') {
        const file = await tauri.dialog.open({ multiple: false, directory: false, title, filters: [{ name: accept === 'zip' ? 'ZIP' : accept === 'image' ? 'Images' : 'Files', extensions: accept === 'zip' ? ['zip'] : accept === 'image' ? ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] : ['json'] }] });
        if (!file) return null;
        if (typeof file === 'string') {
            const bytes = await nativeReadFile(file);
            return [new File([bytes], file.split(/[\\/]/).pop() || '选择的文件')];
        }
    }
    return null;
}

function triggerInput(input) {
    input.click();
}

function setRangeLabel(input, label) {
    const target = document.querySelector(`[data-range-label="${label}"]`);
    if (target) target.textContent = qualityToLabel(input.value);
}

function createUI() {
    if (document.getElementById(`${EXT_ID}-root`)) return;
    const root = document.createElement('div');
    root.id = `${EXT_ID}-root`;
    root.className = 'inline-drawer xztb-drawer';
    root.innerHTML = `
        <div class="inline-drawer-toggle inline-drawer-header xztb-header"><b>🧰 小众工具箱 v${EXT_VERSION}</b><div class="inline-drawer-icon fa-fw fa-solid fa-circle-chevron-down"></div></div>
        <div class="inline-drawer-content xztb-content">
            <div class="xztb-tools">
                <button class="menu_button xztb-tool" type="button" data-tool="clean">🧹 清理维护</button>
                <button class="menu_button xztb-tool" type="button" data-tool="install">📦 扩展导入</button>
                <button class="menu_button xztb-tool" type="button" data-tool="image">🖼️ 图片转换</button>
                <button class="menu_button xztb-tool" type="button" data-tool="preset">📋 Preset 整理</button>
            </div>
            <div class="xztb-panel" data-panel="clean">
                <div class="xztb-group">
                    <div class="xztb-row"><label class="xztb-inline-label">聊天闲置超过 <input class="text_pole xztb-days" type="number" min="1" value="15" data-chat-days> 天</label><button class="menu_button" type="button" data-clean-scan>🔍 一键扫描全部</button></div>
                    <div class="xztb-status" data-clean-status></div>
                    <div class="xztb-list" data-clean-results></div>
                </div>
            </div>
            <div class="xztb-panel xztb-hidden" data-panel="install">
                <div class="xztb-group">
                    <div class="xztb-subtitle">📦 从本机选择 ZIP</div>
                    <input class="xztb-file-input" type="file" accept=".zip,application/zip,application/x-zip-compressed" data-zip-file>
                    <button class="menu_button xztb-picker-button" type="button" data-zip-pick>选择 ZIP 文件</button>
                    <div class="xztb-note">选择后会读取 manifest.json、识别扩展名和版本，并检查是否存在同名安装。</div>
                    <div class="xztb-status" data-zip-status></div>
                    <div class="xztb-status" data-zip-meta></div>
                    <div class="xztb-row" data-zip-actions></div>
                </div>
            </div>
            <div class="xztb-panel xztb-hidden" data-panel="image">
                <div class="xztb-group">
                    <div class="xztb-subtitle">🖼️ 图片格式转换</div>
                    <input class="xztb-file-input" type="file" accept="image/*" data-image-file>
                    <button class="menu_button xztb-picker-button" type="button" data-image-pick>选择本机图片</button>
                    <div class="xztb-row"><label class="xztb-inline-label">输出格式 <select class="text_pole" data-image-format><option value="jpeg">JPEG</option><option value="webp">WEBP</option><option value="png">PNG</option></select></label><label class="xztb-inline-label xztb-grow">最大尺寸 <select class="text_pole" data-image-dimension><option value="0">不限制</option><option value="4096">4096 px</option><option value="2560">2560 px</option><option value="1920">1920 px</option><option value="1280">1280 px</option></select></label></div>
                    <div data-image-quality-wrap>
                        <label class="xztb-range-label">画质 <input type="range" min="0.55" max="0.95" step="0.01" value="0.82" data-image-quality><b data-range-label="image-quality">82%</b></label>
                    </div>
                    <div data-image-png-wrap class="xztb-hidden"><label class="xztb-inline-label">PNG 颜色规则 <select class="text_pole" data-image-png-colors><option value="256">256 色压缩</option><option value="128">128 色压缩</option><option value="64">64 色压缩</option><option value="0">无损直出</option></select></label></div>
                    <button class="menu_button" type="button" data-image-convert>转换并导出</button>
                    <div class="xztb-status" data-image-status></div>
                </div>
            </div>
            <div class="xztb-panel xztb-hidden" data-panel="preset">
                <div class="xztb-group">
                    <div class="xztb-subtitle">📋 Preset JSON 整理</div>
                    <label class="xztb-check-row"><input type="checkbox" checked disabled><span><b>按 Preset 内置排序整理 prompts</b><small>唯一处理规则：读取 prompt_order 的 identifier 顺序重排 prompts。</small></span></label><div class="xztb-note">不会修改条目字段、prompt_order、其他顶层数据或对象内部字段顺序。</div>
                    <input class="xztb-file-input" type="file" accept="application/json,.json" data-preset-file>
                    <button class="menu_button xztb-picker-button" type="button" data-preset-pick>选择 Preset JSON</button>
                    <div class="xztb-row xztb-hidden" data-preset-group-wrap><label class="xztb-inline-label">排序组 <select class="text_pole" data-preset-group></select></label></div>
                    <button class="menu_button" type="button" data-preset-sort>开始整理</button>
                    <div class="xztb-status" data-preset-status></div>
                </div>
            </div>
        </div>`;
    const target = document.querySelector('#extensions_settings2, #extensions_settings');
    if (!target) {
        setTimeout(createUI, 500);
        return;
    }
    target.appendChild(root);
    const showTool = name => {
        root.querySelectorAll('.xztb-tool').forEach(t => t.classList.toggle('xztb-active', t.dataset.tool === name));
        root.querySelectorAll('.xztb-panel').forEach(p => p.classList.toggle('xztb-hidden', p.dataset.panel !== name));
    };
    root.querySelectorAll('.xztb-tool').forEach(t => t.addEventListener('click', () => showTool(t.dataset.tool)));
    showTool('clean');
    root.querySelector('[data-clean-scan]').addEventListener('click', () => scanAllCleanup(root));
    root.querySelector('[data-clean-results]').addEventListener('click', event => {
        const button = event.target.closest('[data-clean-action]');
        if (button) handleCleanAction(root, button.dataset.cleanAction);
    });
    const zipFile = root.querySelector('[data-zip-file]');
    const zipStatus = root.querySelector('[data-zip-status]');
    const zipMeta = root.querySelector('[data-zip-meta]');
    const zipActions = root.querySelector('[data-zip-actions]');
    root.querySelector('[data-zip-pick]').addEventListener('click', async () => {
        try {
            const files = await openNativeGenericPicker('zip', '选择扩展 ZIP');
            if (files?.[0]) {
                const transfer = new DataTransfer();
                transfer.items.add(files[0]);
                zipFile.files = transfer.files;
                zipFile.dispatchEvent(new Event('change', { bubbles: true }));
                return;
            }
        } catch (error) {
            zipStatus.textContent = `原生文件选择失败：${error?.message || error}`;
        }
        triggerInput(zipFile);
    });
    zipFile.addEventListener('change', async event => {
        const file = event.target.files?.[0];
        if (!file) return;
        zipStatus.textContent = '正在检查 ZIP…';
        zipMeta.textContent = '';
        try {
            await inspectZip(file, zipStatus, zipActions, zipMeta);
            zipStatus.textContent = `已选择：${file.name}（${Math.round(file.size / 1024)} KB）。`;
        } catch (error) {
            zipStatus.textContent = `ZIP 检查失败：${error?.message || error}`;
            zipActions.innerHTML = '';
        }
    });
    const imageFile = root.querySelector('[data-image-file]');
    const imageStatus = root.querySelector('[data-image-status]');
    const imageFormat = root.querySelector('[data-image-format]');
    const imageQualityWrap = root.querySelector('[data-image-quality-wrap]');
    const imagePngWrap = root.querySelector('[data-image-png-wrap]');
    const imageQuality = root.querySelector('[data-image-quality]');
    const syncImageOptions = () => {
        const png = imageFormat.value === 'png';
        imageQualityWrap.classList.toggle('xztb-hidden', png);
        imagePngWrap.classList.toggle('xztb-hidden', !png);
    };
    imageFormat.addEventListener('change', syncImageOptions);
    imageQuality.addEventListener('input', () => setRangeLabel(imageQuality, 'image-quality'));
    root.querySelector('[data-image-pick]').addEventListener('click', async () => {
        try {
            const files = await openNativeGenericPicker('image', '选择本机图片');
            if (files?.[0]) {
                const transfer = new DataTransfer();
                transfer.items.add(files[0]);
                imageFile.files = transfer.files;
                imageFile.dispatchEvent(new Event('change', { bubbles: true }));
                return;
            }
        } catch (error) {
            imageStatus.textContent = `原生文件选择失败：${error?.message || error}`;
        }
        triggerInput(imageFile);
    });
    root.querySelector('[data-image-convert]').addEventListener('click', async () => {
        const file = imageFile.files?.[0];
        const format = imageFormat.value;
        if (!file) {
            imageStatus.textContent = '请先选择本机图片。';
            return;
        }
        imageStatus.textContent = format === 'png' ? '正在转换 PNG…' : `正在转换 ${format.toUpperCase()}…`;
        try {
            await convertImage(file, format, {
                quality: Number(imageQuality.value),
                maxDimension: Number(root.querySelector('[data-image-dimension]').value),
                pngColors: Number(root.querySelector('[data-image-png-colors]').value),
            }, imageStatus);
        } catch (e) {
            imageStatus.textContent = `转换失败：${e?.message || e}`;
            console.error('[小众工具箱]', e);
        }
    });
    syncImageOptions();
    const presetFile = root.querySelector('[data-preset-file]');
    const presetStatus = root.querySelector('[data-preset-status]');
    const presetGroupWrap = root.querySelector('[data-preset-group-wrap]');
    const presetGroup = root.querySelector('[data-preset-group]');
    root.querySelector('[data-preset-pick]').addEventListener('click', async () => {
        try {
            const files = await openNativeGenericPicker('json', '选择 Preset JSON');
            if (files?.[0]) {
                const transfer = new DataTransfer();
                transfer.items.add(files[0]);
                presetFile.files = transfer.files;
                presetFile.dispatchEvent(new Event('change', { bubbles: true }));
                return;
            }
        } catch (error) {
            presetStatus.textContent = `原生文件选择失败：${error?.message || error}`;
        }
        triggerInput(presetFile);
    });
    presetFile.addEventListener('change', async event => {
        const file = event.target.files?.[0];
        if (!file) return;
        try {
            const rootData = JSON.parse(await file.text());
            const groups = Array.isArray(rootData?.prompt_order) ? rootData.prompt_order.filter(group => group && Array.isArray(group.order)) : [];
            presetGroup.innerHTML = '';
            groups.forEach((group, index) => {
                const option = document.createElement('option');
                option.value = String(index);
                const characterId = group?.character_id ?? '未知';
                option.textContent = `第 ${index + 1} 组（character_id ${characterId}，${group.order.length} 项）`;
                presetGroup.appendChild(option);
            });
            presetGroupWrap.classList.toggle('xztb-hidden', groups.length <= 1);
            presetStatus.textContent = `已选择：${file.name}；发现 ${Array.isArray(rootData?.prompts) ? rootData.prompts.length : 0} 个 prompts。`;
        } catch (error) {
            presetGroupWrap.classList.add('xztb-hidden');
            presetStatus.textContent = `JSON 读取失败：${error?.message || error}`;
        }
    });
    root.querySelector('[data-preset-sort]').addEventListener('click', async () => {
        const file = presetFile.files?.[0];
        if (!file) {
            presetStatus.textContent = '请先选择本机 Preset JSON。';
            return;
        }
        presetStatus.textContent = '正在整理…';
        try {
            await handlePresetFile(file, presetStatus, Number(presetGroup.value || 0));
        } catch (e) {
            presetStatus.textContent = `整理失败：${e?.message || e}`;
            console.error('[小众工具箱]', e);
        }
    });
}

async function init() {
    try {
        await waitHost();
    } catch (e) {
        console.warn('[小众工具箱] Host ready 等待失败:', e);
    }
    createUI();
}

init();
export { init, reorderPresetPrompts, compareVersions };

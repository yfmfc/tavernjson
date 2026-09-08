const EXT_ID = 'xiaozhong-toolbox';
const EXT_VERSION = '0.3.0';

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
    return `${JSON.stringify(value, null, 4)}\n`;
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
    const used = new Set();
    for (const id of idSequence) {
        const prompt = byId.get(id);
        if (prompt && !used.has(prompt)) {
            result.push(prompt);
            used.add(prompt);
        }
    }
    for (const prompt of root.prompts) if (!used.has(prompt)) result.push(prompt);
    const output = structuredClone(root);
    output.prompts = result;
    const referenced = idSequence.filter(id => byId.has(id)).length;
    return { output, total: root.prompts.length, referenced, unreferenced: root.prompts.length - referenced };
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

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function getImageQuality(format, quality) {
    const base = clamp(Number(quality) || 75, 20, 100);
    if (format === 'jpeg') return base / 100;
    if (format === 'webp') return base / 100;
    return 1;
}

async function canvasToCompressedPng(canvas) {
    const native = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!native) throw new Error('PNG 编码失败。');
    const maxNative = Math.max(1024 * 1024, canvas.width * canvas.height * 0.5);
    if (native.size <= maxNative || !globalThis.CompressionStream) return native;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return native;
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { data, width, height } = image;
    const bins = 1 << 15;
    const counts = new Uint32Array(bins);
    const sumsR = new Uint32Array(bins);
    const sumsG = new Uint32Array(bins);
    const sumsB = new Uint32Array(bins);
    const sumsA = new Uint32Array(bins);
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
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
    const paletteKeys = occupied.slice(0, Math.min(256, occupied.length));
    if (!paletteKeys.length) return native;
    const palette = new Uint8Array(paletteKeys.length * 4);
    for (let i = 0; i < paletteKeys.length; i++) {
        const key = paletteKeys[i];
        const count = counts[key];
        palette[i * 4] = Math.round(sumsR[key] / count);
        palette[i * 4 + 1] = Math.round(sumsG[key] / count);
        palette[i * 4 + 2] = Math.round(sumsB[key] / count);
        palette[i * 4 + 3] = Math.round(sumsA[key] / count);
    }
    const binToPalette = new Uint8Array(bins);
    for (let key = 0; key < bins; key++) {
        const r = ((key >> 10) & 31) * 8 + 4;
        const g = ((key >> 5) & 31) * 8 + 4;
        const b = (key & 31) * 8 + 4;
        let best = 0;
        let bestDistance = Infinity;
        for (let p = 0; p < paletteKeys.length; p++) {
            const pr = palette[p * 4];
            const pg = palette[p * 4 + 1];
            const pb = palette[p * 4 + 2];
            const dr = r - pr;
            const dg = g - pg;
            const db = b - pb;
            const distance = dr * dr + dg * dg + db * db;
            if (distance < bestDistance) {
                bestDistance = distance;
                best = p;
            }
        }
        binToPalette[key] = best;
    }
    const raw = new Uint8Array(height * (width + 1));
    let offset = 0;
    for (let y = 0; y < height; y++) {
        raw[offset++] = 0;
        const row = y * width * 4;
        for (let x = 0; x < width; x++) {
            const p = row + x * 4;
            const key = ((data[p] >> 3) << 10) | ((data[p + 1] >> 3) << 5) | (data[p + 2] >> 3);
            raw[offset++] = binToPalette[key];
        }
    }
    const compressed = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
    const quantized = buildIndexedPng(width, height, palette, compressed);
    return quantized.size < native.size ? quantized : native;
}

function buildIndexedPng(width, height, palette, compressed) {
    const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const makeChunk = (type, payload) => {
        const typeBytes = new TextEncoder().encode(type);
        const bytes = new Uint8Array(12 + payload.length);
        const view = new DataView(bytes.buffer);
        view.setUint32(0, payload.length);
        bytes.set(typeBytes, 4);
        bytes.set(payload, 8);
        view.setUint32(bytes.length - 4, crc32Concat(typeBytes, payload));
        return bytes;
    };
    const ihdr = new Uint8Array(13);
    const view = new DataView(ihdr.buffer);
    view.setUint32(0, width);
    view.setUint32(4, height);
    view.setUint8(8, 8);
    view.setUint8(9, 3);
    const plte = new Uint8Array(palette.length * 3);
    const trns = new Uint8Array(palette.length);
    let hasAlpha = false;
    for (let i = 0; i < palette.length; i++) {
        const [r, g, b, a] = palette[i];
        plte[i * 3] = r;
        plte[i * 3 + 1] = g;
        plte[i * 3 + 2] = b;
        trns[i] = a;
        if (a !== 255) hasAlpha = true;
    }
    const parts = [signature, makeChunk('IHDR', ihdr), makeChunk('PLTE', plte)];
    if (hasAlpha) parts.push(makeChunk('tRNS', trns));
    parts.push(makeChunk('IDAT', compressed), makeChunk('IEND', new Uint8Array()));
    const size = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return new Blob([out], { type: 'image/png' });
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

async function convertImage(file, format, quality, statusContainer) {
    if (!file.type.startsWith('image/')) throw new Error('请选择图片文件。');
    clearOldDownloads(statusContainer);
    const bitmap = await createImageBitmap(file);
    try {
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d', { alpha: format !== 'jpeg', willReadFrequently: format === 'png' });
        if (!ctx) throw new Error('当前环境无法创建图片画布。');
        if (format === 'jpeg') {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx.drawImage(bitmap, 0, 0);
        const mime = format === 'png' ? 'image/png' : format === 'jpeg' ? 'image/jpeg' : 'image/webp';
        const q = getImageQuality(format, quality);
        const blob = format === 'png'
            ? await canvasToCompressedPng(canvas)
            : await new Promise(resolve => canvas.toBlob(resolve, mime, q));
        if (!blob) throw new Error('图片转换失败。');
        const ext = format === 'jpeg' ? 'jpg' : format;
        const filename = `${getOutputStem(file.name)}.${ext}`;
        const { link } = createBlobSaveLink(blob, filename);
        const result = document.createElement('div');
        result.className = 'xztb-result';
        const ratio = file.size ? blob.size / file.size : 0;
        const saved = file.size ? Math.max(0, 1 - ratio) * 100 : 0;
        result.textContent = `转换完成：${file.name} → ${ext.toUpperCase()}（${bitmap.width}×${bitmap.height}）；原文件 ${formatBytes(file.size)}，输出 ${formatBytes(blob.size)}，${ratio <= 1 ? `体积减少 ${saved.toFixed(1)}%` : `体积增加 ${((ratio - 1) * 100).toFixed(1)}%`}。`;
        statusContainer.append(result, link);
    } finally {
        bitmap.close?.();
    }
}

function formatBytes(value) {
    const bytes = Number(value) || 0;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * SillyTavern compatibility API: GET/POST requests use the host request-header helper from /script.js.
 */
async function getStRequestHeaders() {
    try {
        const script = await import('/script.js');
        if (typeof script.getRequestHeaders === 'function') return script.getRequestHeaders();
    } catch {}
    return { 'Content-Type': 'application/json' };
}

async function stFetch(url, options = {}) {
    const headers = new Headers(options.headers || await getStRequestHeaders());
    if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') headers.set('Content-Type', 'application/json');
    return fetch(url, { ...options, headers });
}

async function stPostJson(url, body) {
    const response = await stFetch(url, { method: 'POST', body: JSON.stringify(body ?? {}) });
    if (!response.ok) throw new Error(`${url} 返回 HTTP ${response.status}`);
    return response.json();
}

/**
 * SillyTavern compatibility API: POST /api/characters/all returns the current character list.
 */
async function getCharacters() {
    const response = await stFetch('/api/characters/all', { method: 'POST', body: '{}' });
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

/**
 * SillyTavern compatibility API: POST /api/worldinfo/list returns available World Info files.
 */
async function listWorlds() {
    const data = await stPostJson('/api/worldinfo/list', {});
    if (!Array.isArray(data)) throw new Error('世界书列表返回格式异常。');
    return data;
}

/**
 * SillyTavern compatibility API: POST /api/worldinfo/get reads one World Info file by name.
 */
async function getWorld(fileId) {
    return stPostJson('/api/worldinfo/get', { name: normalizeWorldId(fileId) });
}

/**
 * SillyTavern compatibility API: POST /api/settings/get reads current world-selection settings.
 */
async function getSettings() {
    return stPostJson('/api/settings/get', {});
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
        if (original && typeof original === 'object') {
            const entries = original.entries;
            if (Array.isArray(entries) || (entries && typeof entries === 'object')) return original;
        }
    }
    return null;
}

async function getSelectedGlobalWorlds() {
    try {
        const settings = await getSettings();
        const value = settings?.globalSelect ?? settings?.world_info?.globalSelect ?? settings?.world_info?.selected_world_info;
        return new Set(Array.isArray(value) ? value.map(normalizeWorldId) : []);
    } catch {
        return new Set();
    }
}

async function scanEmbeddedWorlds(characters, progress) {
    const worlds = await listWorlds();
    const live = new Map();
    for (const character of characters) {
        const primary = getWorldBindingNames(character);
        if (primary) live.set(primary, character?.name || '');
        const extra = character?.data?.extensions?.world_info?.charLore;
        if (Array.isArray(extra)) {
            for (const row of extra) for (const name of (row?.extraBooks || [])) {
                const world = normalizeWorldId(name);
                if (world) live.set(world, character?.name || '');
            }
        }
    }
    const selectedGlobal = await getSelectedGlobalWorlds();
    const candidates = [];
    const errors = [];
    for (let i = 0; i < worlds.length; i++) {
        const item = worlds[i] || {};
        const fileId = normalizeWorldId(item.file_id ?? item.name);
        const displayName = String(item.name || fileId);
        if (!fileId) continue;
        progress?.(`扫描世界书 ${i + 1}/${worlds.length}…`);
        try {
            const data = extractWorldData(await getWorld(fileId));
            const original = getOriginalCharacterBook(data);
            if (!original) continue;
            const bound = live.get(fileId) || live.get(normalizeWorldId(displayName));
            const global = selectedGlobal.has(fileId) || selectedGlobal.has(normalizeWorldId(displayName));
            if (bound || global) continue;
            const entries = original?.entries ? (Array.isArray(original.entries) ? original.entries.length : Object.keys(original.entries).length) : 0;
            candidates.push({
                worldId: fileId,
                name: displayName,
                entries,
                sourceName: String(original?.name || ''),
                detail: '发现 Character Book 原始数据，当前没有角色卡绑定或全局使用。',
            });
        } catch (error) {
            errors.push({ kind: 'world', fileId, error });
        }
    }
    return { candidates, errors, total: worlds.length };
}

function parseChatTimestamp(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
    if (typeof value !== 'string') return NaN;
    const trimmed = value.trim();
    if (!trimmed) return NaN;
    if (/^\d+$/.test(trimmed)) {
        const number = Number(trimmed);
        return number < 1e12 ? number * 1000 : number;
    }
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : NaN;
}

function extractChatRows(payload) {
    if (Array.isArray(payload)) return payload;
    if (payload && Array.isArray(payload.chats)) return payload.chats;
    if (payload && typeof payload === 'object') return Object.values(payload);
    return [];
}

/**
 * SillyTavern compatibility API: POST /api/chats/search searches chat files and is the broadest public chat-list endpoint available here.
 */
async function searchAllChats() {
    const attempts = [
        { query: '', avatar_url: '', group_id: null, offset: 0, limit: 10000 },
        { query: '', avatar_url: '', offset: 0, limit: 10000 },
        { query: '', avatar_url: '' },
    ];
    let lastError = null;
    for (const body of attempts) {
        try {
            const response = await stFetch('/api/chats/search', { method: 'POST', body: JSON.stringify(body) });
            if (!response.ok) {
                lastError = new Error(`/api/chats/search 返回 HTTP ${response.status}`);
                continue;
            }
            const data = await response.json();
            return extractChatRows(data);
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error('聊天搜索失败。');
}

/**
 * SillyTavern compatibility API: POST /api/characters/chats returns chat files for one existing character.
 */
async function getCharacterChats(avatar) {
    const response = await stFetch('/api/characters/chats', { method: 'POST', body: JSON.stringify({ avatar_url: avatar, simple: false }) });
    if (!response.ok) throw new Error(`/api/characters/chats 返回 HTTP ${response.status}`);
    return response.json();
}

async function scanOldChats(days, characters, progress) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const candidates = [];
    const errors = [];
    const seen = new Set();
    let rows = [];
    try {
        rows = await searchAllChats();
    } catch (error) {
        errors.push({ kind: 'chat-search', error });
    }
    const characterByAvatar = new Map(characters.filter(x => x?.avatar).map(x => [String(x.avatar), x]));
    for (const row of rows) {
        if (!row?.file_name) continue;
        const avatar = String(row.avatar_url || row.avatar || '');
        const fileName = String(row.file_name).replace(/\.jsonl$/i, '');
        const character = characterByAvatar.get(avatar);
        const time = parseChatTimestamp(row.date_last_chat ?? row.last_mes ?? row.last_message ?? row.updatedAt ?? row.date);
        if (!Number.isFinite(time) || time >= cutoff) continue;
        const chatId = `${avatar}::${fileName}`;
        if (seen.has(chatId)) continue;
        seen.add(chatId);
        const current = character?.chat && String(character.chat) === fileName;
        candidates.push({
            chatId,
            fileName,
            avatar,
            characterName: String(row.character_name || character?.name || '未知角色'),
            time,
            current: Boolean(current),
            deletable: Boolean(avatar),
            detail: `${formatDate(time)}；角色：${String(row.character_name || character?.name || '未知角色')}${!avatar ? '；缺少删除所需角色路径，当前不提供删除' : ''}`,
        });
    }
    if (!rows.length) {
        for (let i = 0; i < characters.length; i++) {
            const character = characters[i] || {};
            if (!character.avatar) continue;
            progress?.(`兼容扫描聊天 ${i + 1}/${characters.length}…`);
            try {
                const data = await getCharacterChats(character.avatar);
                for (const row of extractChatRows(data)) {
                    if (!row?.file_name) continue;
                    const fileName = String(row.file_name).replace(/\.jsonl$/i, '');
                    const time = parseChatTimestamp(row.date_last_chat ?? row.last_mes ?? row.last_message ?? row.updatedAt ?? row.date);
                    if (!Number.isFinite(time) || time >= cutoff) continue;
                    const chatId = `${character.avatar}::${fileName}`;
                    if (seen.has(chatId)) continue;
                    seen.add(chatId);
                    candidates.push({
                        chatId,
                        fileName,
                        avatar: character.avatar,
                        characterName: character.name || '未知角色',
                        time,
                        current: character.chat && String(character.chat) === fileName,
                        deletable: true,
                        detail: `${formatDate(time)}；角色：${character.name || '未知角色'}`,
                    });
                }
            } catch (error) {
                errors.push({ kind: 'chat-character', character, error });
            }
        }
    }
    candidates.sort((a, b) => a.time - b.time);
    return { candidates, errors };
}

async function scanWebCaches() {
    if (!('caches' in globalThis)) return { supported: false, caches: [] };
    const names = await caches.keys();
    const result = [];
    for (const name of names) {
        let entries = [];
        try { entries = await (await caches.open(name)).keys(); } catch {}
        result.push({ name, cacheId: name, entries: entries.length });
    }
    return { supported: true, caches: result };
}

/**
 * TauriTavern compatibility API: POST /api/extensions/discover returns discovered third-party extension metadata.
 */
async function discoverExtensions() {
    try {
        const response = await stFetch('/api/extensions/discover', { method: 'POST', body: '{}' });
        if (!response.ok) return [];
        const data = await response.json();
        return Array.isArray(data) ? data : Object.values(data || {});
    } catch {
        return [];
    }
}

function normalizeExtensionName(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/\.git$/i, '')
        .replace(/[-_ ]?(main|master|develop|dev)$/i, '')
        .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
}

function buildExtensionIdentity(pathName, manifest) {
    const display = String(manifest?.display_name || manifest?.name || pathName || '').trim();
    return {
        folder: pathName,
        displayName: display || pathName,
        stableId: String(manifest?.id || manifest?.extension_id || '').trim(),
        source: String(manifest?.homePage || manifest?.repository || manifest?.repo || '').trim(),
        normalizedName: normalizeExtensionName(display || pathName),
    };
}

function parseZipEntries(buffer) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    const decoder = new TextDecoder();
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 0x10016); i--) {
        if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('ZIP 缺少中央目录。');
    const totalEntries = view.getUint16(eocd + 10, true);
    const directorySize = view.getUint32(eocd + 12, true);
    const directoryOffset = view.getUint32(eocd + 16, true);
    if (directoryOffset + directorySize > bytes.length) throw new Error('ZIP 中央目录越界。');
    const entries = [];
    let cursor = directoryOffset;
    for (let i = 0; i < totalEntries && cursor + 46 <= bytes.length; i++) {
        if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error('ZIP 中央目录损坏。');
        const flags = view.getUint16(cursor + 8, true);
        const method = view.getUint16(cursor + 10, true);
        const compressedSize = view.getUint32(cursor + 20, true);
        const uncompressedSize = view.getUint32(cursor + 24, true);
        const nameLength = view.getUint16(cursor + 28, true);
        const extraLength = view.getUint16(cursor + 30, true);
        const commentLength = view.getUint16(cursor + 32, true);
        const localOffset = view.getUint32(cursor + 42, true);
        const rawName = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
        const name = decoder.decode(rawName).replaceAll('\\', '/').replace(/^\/+/, '');
        entries.push({ name, flags, method, compressedSize, uncompressedSize, localOffset });
        cursor += 46 + nameLength + extraLength + commentLength;
    }
    if (entries.length !== totalEntries) throw new Error('ZIP 条目读取不完整。');
    return entries;
}

async function readZipEntry(buffer, entry) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    const offset = entry.localOffset;
    if (view.getUint32(offset, true) !== 0x04034b50) throw new Error(`ZIP 本地文件头损坏：${entry.name}`);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const start = offset + 30 + nameLength + extraLength;
    const compressed = bytes.slice(start, start + entry.compressedSize);
    if (entry.flags & 0x01) throw new Error(`ZIP 条目已加密，无法读取：${entry.name}`);
    if (entry.method === 0) return compressed;
    if (entry.method === 8 && globalThis.DecompressionStream) {
        return new Uint8Array(await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    }
    throw new Error(`当前环境不支持 ZIP 压缩方式 ${entry.method}：${entry.name}`);
}

function findManifestCandidates(entries) {
    return entries.filter(entry => !entry.name.endsWith('/') && entry.name.split('/').pop()?.toLowerCase() === 'manifest.json');
}

async function inspectZipArchive(file) {
    const buffer = await file.arrayBuffer();
    const entries = parseZipEntries(buffer);
    const manifests = findManifestCandidates(entries);
    const candidates = [];
    for (const manifestEntry of manifests) {
        const parts = manifestEntry.name.split('/').filter(Boolean);
        const folder = parts.length > 1 ? parts[parts.length - 2] : '';
        let manifest = {};
        try {
            const raw = await readZipEntry(buffer, manifestEntry);
            manifest = JSON.parse(new TextDecoder().decode(raw));
        } catch {}
        candidates.push(buildExtensionIdentity(folder, manifest));
    }
    const rootFolders = [...new Set(entries.map(entry => entry.name.split('/')[0]).filter(Boolean))];
    const rootFiles = entries.filter(entry => !entry.name.includes('/')).length;
    let selected = candidates.sort((a, b) => a.folder.length - b.folder.length)[0];
    if (!selected && rootFolders.length === 1 && rootFiles > 0) selected = buildExtensionIdentity(rootFolders[0], {});
    if (!selected && rootFolders.length === 1) selected = buildExtensionIdentity(rootFolders[0], {});
    if (!selected) selected = buildExtensionIdentity(file.name.replace(/\.zip$/i, ''), {});
    return { entries, candidates, selected, rootFolders, size: file.size };
}

/**
 * TauriTavern compatibility API: POST /api/extensions/discover returns installed extensions; local ZIP installation itself has no documented public endpoint in the current contract.
 */
async function getInstalledExtensions() {
    return discoverExtensions();
}

function collectInstalledIdentity(ext) {
    const folder = String(ext?.name || ext?.folder || ext?.extensionName || ext?.id || '').trim();
    const display = String(ext?.display_name || ext?.displayName || ext?.name || folder).trim();
    return buildExtensionIdentity(folder, { display_name: display, id: ext?.id, homePage: ext?.homePage || ext?.repository });
}

function findExtensionConflicts(installed, incoming) {
    const exact = installed.find(item => item.folder && incoming.folder && item.folder.toLowerCase() === incoming.folder.toLowerCase());
    if (exact) return { type: 'exact', matches: [exact] };
    if (incoming.stableId) {
        const idMatches = installed.filter(item => item.stableId && item.stableId === incoming.stableId);
        if (idMatches.length) return { type: 'stable-id', matches: idMatches };
    }
    if (incoming.source) {
        const sourceMatches = installed.filter(item => item.source && item.source === incoming.source);
        if (sourceMatches.length) return { type: 'source', matches: sourceMatches };
    }
    const normalized = incoming.normalizedName;
    const similar = installed.filter(item => normalized && item.normalizedName && item.normalizedName === normalized);
    if (similar.length) return { type: 'similar', matches: similar };
    return { type: 'none', matches: [] };
}

async function inspectZip(file, root) {
    const status = root.querySelector('[data-zip-status]');
    const actions = root.querySelector('[data-zip-actions]');
    actions.innerHTML = '';
    if (!/\.zip$/i.test(file.name)) throw new Error('请选择 ZIP 文件。');
    status.textContent = `正在读取 ${file.name}…`;
    const archive = await inspectZipArchive(file);
    const installed = (await getInstalledExtensions()).map(collectInstalledIdentity).filter(item => item.folder);
    const conflict = findExtensionConflicts(installed, archive.selected);
    root.__xztbZipState = { file, archive, installed, conflict, scope: 'local' };
    const info = document.createElement('div');
    info.className = 'xztb-result';
    const matchText = conflict.type === 'none'
        ? '未发现明显冲突。'
        : conflict.type === 'similar'
            ? `发现名称相近的扩展：${conflict.matches.map(x => x.folder).join('、')}。需要人工确认。`
            : `发现已安装扩展：${conflict.matches.map(x => x.folder).join('、')}。`;
    info.textContent = `识别为：${archive.selected.displayName}；目录：${archive.selected.folder || '自动判断'}；${matchText}`;
    actions.appendChild(info);
    const install = document.createElement('button');
    install.type = 'button';
    install.className = 'menu_button';
    install.textContent = '继续处理安装';
    install.addEventListener('click', () => prepareZipInstall(root));
    actions.appendChild(install);
    status.textContent = `ZIP 读取完成：${file.name}（${formatBytes(file.size)}）。`;
}

function prepareZipInstall(root) {
    const state = root.__xztbZipState;
    if (!state) return;
    const status = root.querySelector('[data-zip-status]');
    const actions = root.querySelector('[data-zip-actions]');
    clearChildren(actions);
    const conflict = state.conflict;
    const scope = root.querySelector('[data-zip-scope]').value;
    state.scope = scope;
    const summary = document.createElement('div');
    summary.className = 'xztb-note';
    summary.textContent = conflict.type === 'none'
        ? '当前没有检测到已有扩展冲突。'
        : `当前检测到冲突对象：${conflict.matches.map(x => x.folder).join('、')}。`;
    actions.appendChild(summary);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'menu_button';
    if (conflict.type === 'none') button.textContent = '开始安装';
    else if (conflict.type === 'exact' || conflict.type === 'stable-id' || conflict.type === 'source') button.textContent = '覆盖现有扩展';
    else button.textContent = '确认按同名候选覆盖';
    button.addEventListener('click', () => installZip(root, conflict));
    actions.appendChild(button);
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'menu_button';
    cancel.textContent = '取消';
    cancel.addEventListener('click', () => {
        actions.innerHTML = '';
        status.textContent = '已取消。';
    });
    actions.appendChild(cancel);
    status.textContent = '请确认安装范围和冲突处理方式。';
}

async function installZip(root, conflict) {
    const status = root.querySelector('[data-zip-status]');
    const state = root.__xztbZipState;
    if (!state) return;
    if (conflict.matches.length && !confirm(`检测到现有扩展 ${conflict.matches.map(x => x.folder).join('、')}。确定覆盖吗？`)) return;
    status.textContent = '正在检查 TauriTavern 的公开本地扩展安装能力…';
    status.textContent = '当前 TauriTavern 公开 Host Contract 未提供本地 ZIP 写入第三方扩展目录的接口。已完成扩展识别、安装范围和覆盖判断；不会调用未公开的私有命令。';
}

function clearChildren(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
}

/**
 * SillyTavern compatibility API: POST /api/worldinfo/delete deletes one World Info file by name.
 */
async function clearSelectedWorlds(selected) {
    let deleted = 0;
    let failures = 0;
    for (const item of selected) {
        try {
            const response = await stFetch('/api/worldinfo/delete', { method: 'POST', body: JSON.stringify({ name: normalizeWorldId(item) }) });
            if (response.ok) deleted++; else failures++;
        } catch { failures++; }
    }
    return { deleted, failures };
}

/**
 * SillyTavern compatibility API: POST /api/chats/delete deletes a chat using chatfile and avatar_url.
 */
async function clearSelectedChats(selected) {
    let deleted = 0;
    let failures = 0;
    for (const item of selected) {
        if (!item.avatar || !item.fileName) {
            failures++;
            continue;
        }
        try {
            const response = await stFetch('/api/chats/delete', { method: 'POST', body: JSON.stringify({ chatfile: `${item.fileName}.jsonl`, avatar_url: item.avatar }) });
            if (response.ok) deleted++; else failures++;
        } catch { failures++; }
    }
    return { deleted, failures };
}

function updateCleanSelection(root) {
    const inputs = [...root.querySelectorAll('[data-clean-item]')];
    const selected = inputs.filter(input => input.checked && !input.disabled).length;
    const total = inputs.filter(input => !input.disabled).length;
    const label = root.querySelector('[data-clean-selected-count]');
    if (label) label.textContent = `已选择 ${selected} / ${total} 项`;
    const global = root.querySelector('[data-clean-all]');
    if (global) global.checked = total > 0 && selected === total;
    root.querySelectorAll('[data-clean-group-all]').forEach(control => {
        const group = control.closest('[data-clean-group]');
        const groupInputs = [...group.querySelectorAll('[data-clean-item]')].filter(input => !input.disabled);
        const groupSelected = groupInputs.filter(input => input.checked).length;
        control.checked = groupInputs.length > 0 && groupSelected === groupInputs.length;
    });
}

function renderCleanResults(root, state) {
    const box = root.querySelector('[data-clean-results]');
    clearChildren(box);
    const renderGroup = (title, rows, getKey, detailFn, options = {}) => {
        const group = document.createElement('section');
        group.className = 'xztb-clean-group';
        group.dataset.cleanGroup = getKey;
        const header = document.createElement('div');
        header.className = 'xztb-clean-group-header';
        const label = document.createElement('label');
        label.className = 'xztb-check-title';
        const all = document.createElement('input');
        all.type = 'checkbox';
        all.dataset.cleanGroupAll = '1';
        all.addEventListener('change', () => {
            group.querySelectorAll('[data-clean-item]:not(:disabled)').forEach(input => input.checked = all.checked);
            updateCleanSelection(root);
        });
        const titleText = document.createElement('b');
        titleText.textContent = `${title}（${rows.length}）`;
        label.append(all, titleText);
        header.appendChild(label);
        const list = document.createElement('div');
        list.className = 'xztb-list';
        if (!rows.length) {
            const empty = document.createElement('div');
            empty.className = 'xztb-note';
            empty.textContent = '没有发现。';
            list.appendChild(empty);
        } else {
            for (const row of rows) {
                const item = document.createElement('label');
                item.className = 'xztb-check-row';
                const input = document.createElement('input');
                input.type = 'checkbox';
                input.dataset.cleanItem = '1';
                input.dataset.cleanKey = getKey;
                input.value = row[getKey] ?? '';
                input.disabled = options.disabledFn ? options.disabledFn(row) : false;
                input.addEventListener('change', () => updateCleanSelection(root));
                const text = document.createElement('span');
                const strong = document.createElement('b');
                strong.textContent = row.name || row.fileName || row.characterName || row.id || '未命名';
                const small = document.createElement('small');
                small.textContent = detailFn(row);
                text.append(strong, small);
                item.append(input, text);
                list.appendChild(item);
            }
        }
        const actionRow = document.createElement('div');
        actionRow.className = 'xztb-row';
        const clean = document.createElement('button');
        clean.type = 'button';
        clean.className = 'menu_button';
        clean.textContent = `清理选中 ${title}`;
        clean.addEventListener('click', () => handleCleanAction(root, getKey));
        actionRow.appendChild(clean);
        group.append(header, list, actionRow);
        box.appendChild(group);
    };
    const summary = document.createElement('div');
    summary.className = 'xztb-summary';
    summary.textContent = `扫描完成：角色卡孤儿世界书 ${state.worldCandidates.length}、旧聊天 ${state.chatCandidates.length}、浏览器缓存 ${state.webCaches.length}。`;
    box.appendChild(summary);
    renderGroup('🌍 角色卡导入后遗留世界书', state.worldCandidates, 'worldId', r => `${r.detail}${r.sourceName ? `；Character Book：${r.sourceName}` : ''}；${r.entries} 个条目`);
    renderGroup('🗨️ 超过设定天数未使用的聊天', state.chatCandidates, 'chatId', r => r.detail + (r.current ? '；当前聊天，不允许删除' : ''), { disabledFn: r => r.current || !r.deletable });
    renderGroup('🌐 浏览器 Cache Storage', state.webCaches, 'cacheId', r => `${r.entries} 个缓存请求；删除后页面资源可能重新缓存`);
    const unavailable = document.createElement('div');
    unavailable.className = 'xztb-note';
    unavailable.textContent = 'TauriTavern 私有临时目录/HTTP 热缓存没有公开稳定的扩展扫描删除 API，本版不猜目录、不直接访问私有文件。';
    box.appendChild(unavailable);
    if (state.errors.length) {
        const errors = document.createElement('div');
        errors.className = 'xztb-note';
        errors.textContent = `有 ${state.errors.length} 个扫描子项失败；失败项不会自动加入清理。`;
        box.appendChild(errors);
    }
    updateCleanSelection(root);
}

async function scanAllCleanup(root) {
    const status = root.querySelector('[data-clean-status]');
    const results = root.querySelector('[data-clean-results]');
    status.textContent = '正在扫描…';
    clearChildren(results);
    const state = { worldCandidates: [], chatCandidates: [], webCaches: [], errors: [] };
    try {
        const characters = await getCharacters();
        const days = Number(root.querySelector('[data-chat-days]').value) || 15;
        const [worldResult, chatResult, cacheResult] = await Promise.allSettled([
            scanEmbeddedWorlds(characters, message => status.textContent = message),
            scanOldChats(days, characters, message => status.textContent = message),
            scanWebCaches(),
        ]);
        if (worldResult.status === 'fulfilled') {
            state.worldCandidates = worldResult.value.candidates;
            state.errors.push(...worldResult.value.errors);
        } else state.errors.push(worldResult.reason);
        if (chatResult.status === 'fulfilled') {
            state.chatCandidates = chatResult.value.candidates;
            state.errors.push(...chatResult.value.errors);
        } else state.errors.push(chatResult.reason);
        if (cacheResult.status === 'fulfilled') state.webCaches = cacheResult.value.caches;
        else state.errors.push(cacheResult.reason);
        root.__xztbCleanState = state;
        renderCleanResults(root, state);
        status.textContent = '扫描完成。';
    } catch (error) {
        status.textContent = `扫描失败：${error?.message || error}`;
    }
}

async function handleCleanAction(root, key) {
    const state = root.__xztbCleanState;
    if (!state) return;
    const selected = [...root.querySelectorAll(`[data-clean-key="${key}"]:checked`)].filter(input => !input.disabled);
    if (!selected.length) {
        root.querySelector('[data-clean-status]').textContent = '没有选择可清理项目。';
        return;
    }
    if (!confirm(`确定清理选中的 ${selected.length} 项吗？此操作会直接删除本地数据。`)) return;
    try {
        let message = '';
        if (key === 'worldId') {
            const result = await clearSelectedWorlds(selected.map(x => x.value));
            message = `已删除世界书 ${result.deleted} 个${result.failures ? `，失败 ${result.failures} 个` : ''}。`;
        } else if (key === 'chatId') {
            const items = selected.map(input => state.chatCandidates.find(x => x.chatId === input.value)).filter(Boolean);
            const result = await clearSelectedChats(items);
            message = `已删除聊天 ${result.deleted} 个${result.failures ? `，失败 ${result.failures} 个` : ''}。`;
        } else if (key === 'cacheId') {
            let deleted = 0;
            let failures = 0;
            for (const name of selected.map(x => x.value)) {
                try {
                    if (await caches.delete(name)) deleted++; else failures++;
                } catch { failures++; }
            }
            message = `已删除浏览器缓存 ${deleted} 个${failures ? `，失败 ${failures} 个` : ''}。`;
        }
        root.querySelector('[data-clean-status]').textContent = message;
        await scanAllCleanup(root);
    } catch (error) {
        root.querySelector('[data-clean-status]').textContent = `清理失败：${error?.message || error}`;
    }
}

function buildImageControls(root) {
    const format = root.querySelector('[data-image-format]');
    const qualityWrap = root.querySelector('[data-image-quality-wrap]');
    const quality = root.querySelector('[data-image-quality]');
    const value = root.querySelector('[data-image-quality-value]');
    const update = () => {
        const show = format.value !== 'png';
        qualityWrap.classList.toggle('xztb-hidden', !show);
        value.textContent = quality.value;
    };
    format.addEventListener('change', update);
    quality.addEventListener('input', update);
    update();
}

function createUI() {
    if (document.getElementById(`${EXT_ID}-root`)) return;
    const root = document.createElement('div');
    root.id = `${EXT_ID}-root`;
    root.className = 'inline-drawer xztb-drawer';
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
                <div class="xztb-group">
                    <div class="xztb-row">
                        <label class="xztb-inline-label">聊天闲置超过 <input class="text_pole xztb-days" type="number" min="1" value="15" data-chat-days> 天</label>
                        <button class="menu_button" type="button" data-clean-scan>🔍 扫描全部</button>
                    </div>
                    <div class="xztb-row xztb-clean-toolbar">
                        <label class="xztb-check-title"><input type="checkbox" data-clean-all> 全选所有项目</label>
                        <button class="menu_button" type="button" data-clean-uncheck>取消全选</button>
                        <span class="xztb-summary" data-clean-selected-count>已选择 0 / 0 项</span>
                    </div>
                    <div class="xztb-status" data-clean-status></div>
                    <div data-clean-results></div>
                </div>
            </div>
            <div class="xztb-panel xztb-hidden" data-panel="install">
                <div class="xztb-group">
                    <div class="xztb-subtitle">📦 从本机选择 ZIP</div>
                    <div class="xztb-file-picker">
                        <input class="xztb-file-input" type="file" accept=".zip,application/zip,application/x-zip-compressed" data-zip-file>
                        <button class="menu_button" type="button" data-zip-pick>选择本机 ZIP 文件</button>
                        <span class="xztb-file-name" data-zip-file-name>未选择文件</span>
                    </div>
                    <div class="xztb-row">
                        <label class="xztb-inline-label">安装范围
                            <select class="text_pole" data-zip-scope>
                                <option value="local">仅为我安装</option>
                                <option value="global">为所有用户安装</option>
                            </select>
                        </label>
                    </div>
                    <div class="xztb-note">支持本地 ZIP 解析、扩展识别、同名/疑似同名冲突确认。当前 TauriTavern 公开 Host Contract 未提供本地 ZIP 写入第三方扩展目录的 API，因此不会伪装成“安装成功”。</div>
                    <div class="xztb-status" data-zip-status></div>
                    <div class="xztb-row" data-zip-actions></div>
                </div>
            </div>
            <div class="xztb-panel xztb-hidden" data-panel="image">
                <div class="xztb-group">
                    <div class="xztb-subtitle">🖼️ 图片格式转换</div>
                    <div class="xztb-file-picker">
                        <input class="xztb-file-input" type="file" accept="image/*" data-image-file>
                        <button class="menu_button" type="button" data-image-pick>选择本机图片</button>
                        <span class="xztb-file-name" data-image-file-name>未选择文件</span>
                    </div>
                    <div class="xztb-row">
                        <label class="xztb-inline-label">输出格式
                            <select class="text_pole" data-image-format>
                                <option value="png">PNG</option>
                                <option value="jpeg">JPEG</option>
                                <option value="webp">WEBP</option>
                            </select>
                        </label>
                        <div class="xztb-quality" data-image-quality-wrap>
                            <label class="xztb-inline-label">质量 <input type="range" min="20" max="100" step="1" value="75" data-image-quality><span data-image-quality-value>75</span></label>
                        </div>
                        <button class="menu_button" type="button" data-image-convert>转换</button>
                    </div>
                    <div class="xztb-status" data-image-status></div>
                </div>
            </div>
            <div class="xztb-panel xztb-hidden" data-panel="preset">
                <div class="xztb-group">
                    <div class="xztb-subtitle">📋 Preset JSON 整理</div>
                    <div class="xztb-note">只按照 JSON 内已有的 prompt_order 重排 prompts[]；不修改条目内容、ID、prompt_order 或其他数据。</div>
                    <div class="xztb-file-picker">
                        <input class="xztb-file-input" type="file" accept="application/json,.json" data-preset-file>
                        <button class="menu_button" type="button" data-preset-pick>选择本机 Preset JSON</button>
                        <span class="xztb-file-name" data-preset-file-name>未选择文件</span>
                    </div>
                    <button class="menu_button" type="button" data-preset-sort>整理并生成文件</button>
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
        root.querySelectorAll('.xztb-tool').forEach(button => button.classList.toggle('xztb-active', button.dataset.tool === name));
        root.querySelectorAll('.xztb-panel').forEach(panel => panel.classList.toggle('xztb-hidden', panel.dataset.panel !== name));
    };
    root.querySelectorAll('.xztb-tool').forEach(button => button.addEventListener('click', () => showTool(button.dataset.tool)));
    showTool('clean');
    root.querySelector('[data-clean-scan]').addEventListener('click', () => scanAllCleanup(root));
    root.querySelector('[data-clean-all]').addEventListener('change', event => {
        root.querySelectorAll('[data-clean-item]:not(:disabled)').forEach(input => input.checked = event.target.checked);
        updateCleanSelection(root);
    });
    root.querySelector('[data-clean-uncheck]').addEventListener('click', () => {
        root.querySelectorAll('[data-clean-item]').forEach(input => input.checked = false);
        updateCleanSelection(root);
    });
    const bindFilePicker = (buttonSelector, inputSelector, nameSelector) => {
        const button = root.querySelector(buttonSelector);
        const input = root.querySelector(inputSelector);
        const name = root.querySelector(nameSelector);
        button.addEventListener('click', () => input.click());
        input.addEventListener('change', () => {
            name.textContent = input.files?.[0]?.name || '未选择文件';
        });
    };
    bindFilePicker('[data-zip-pick]', '[data-zip-file]', '[data-zip-file-name]');
    bindFilePicker('[data-image-pick]', '[data-image-file]', '[data-image-file-name]');
    bindFilePicker('[data-preset-pick]', '[data-preset-file]', '[data-preset-file-name]');
    root.querySelector('[data-zip-file]').addEventListener('change', async event => {
        const file = event.target.files?.[0];
        if (!file) return;
        try {
            await inspectZip(file, root);
        } catch (error) {
            root.querySelector('[data-zip-status]').textContent = `ZIP 检查失败：${error?.message || error}`;
            root.querySelector('[data-zip-actions]').innerHTML = '';
        }
    });
    root.querySelector('[data-image-convert]').addEventListener('click', async () => {
        const file = root.querySelector('[data-image-file]').files?.[0];
        const format = root.querySelector('[data-image-format]').value;
        const quality = root.querySelector('[data-image-quality]').value;
        const status = root.querySelector('[data-image-status]');
        if (!file) {
            status.textContent = '请先选择本机图片。';
            return;
        }
        status.textContent = format === 'png' ? '正在转换并压缩 PNG…' : `正在转换为 ${format.toUpperCase()}…`;
        try {
            await convertImage(file, format, quality, status);
        } catch (error) {
            status.textContent = `转换失败：${error?.message || error}`;
        }
    });
    root.querySelector('[data-preset-sort]').addEventListener('click', async () => {
        const file = root.querySelector('[data-preset-file]').files?.[0];
        const status = root.querySelector('[data-preset-status]');
        if (!file) {
            status.textContent = '请先选择本机 Preset JSON。';
            return;
        }
        status.textContent = '正在整理…';
        try {
            await handlePresetFile(file, status);
        } catch (error) {
            status.textContent = `整理失败：${error?.message || error}`;
        }
    });
    buildImageControls(root);
}

async function init() {
    try {
        const host = globalThis.__TAURITAVERN__;
        const ready = host?.ready || globalThis.__TAURITAVERN_MAIN_READY__;
        if (ready && typeof ready.then === 'function') await ready;
    } catch {}
    createUI();
}

init();

export { init, reorderPresetPrompts };

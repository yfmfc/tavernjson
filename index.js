(function () {
  'use strict';

  const MODULE = 'tauritavern-toolbox';
  const ui = {};
  const state = {
    preset: null,
    presetResult: null,
    imageBlob: null,
    imageName: '',
    zipFiles: [],
    zipRoot: '',
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  function toast(message, type = 'info') {
    if (typeof window.toastr?.[type] === 'function') window.toastr[type](message);
    else console[type === 'error' ? 'error' : 'log']('[小众工具箱]', message);
  }

  function downloadBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function readTextFile(file) {
    return file.text();
  }

  async function blobToDataURL(blob) {
    return await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(r.error || new Error('读取图片失败'));
      r.onload = () => resolve(r.result);
      r.readAsDataURL(blob);
    });
  }

  async function convertImage(file, format) {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('当前环境无法创建 Canvas');
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const mime = ({ png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' })[format];
    const quality = format === 'png' ? undefined : 0.92;
    const blob = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('图片转换失败')), mime, quality));
    return { blob, width: canvas.width, height: canvas.height, mime };
  }

  function getPromptOrders(data) {
    const groups = Array.isArray(data?.prompt_order) ? data.prompt_order : [];
    return groups
      .filter(g => g && Array.isArray(g.order))
      .map(g => ({ character_id: g.character_id, order: g.order }));
  }

  function organizePreset(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.prompts) || !Array.isArray(data.prompt_order)) {
      throw new Error('这不是可识别的酒馆预设：缺少 prompts 或 prompt_order。');
    }

    const prompts = data.prompts;
    const byId = new Map();
    const duplicateIds = [];
    for (const p of prompts) {
      const id = p?.identifier;
      if (!id) continue;
      if (byId.has(id)) duplicateIds.push(id);
      else byId.set(id, p);
    }

    const orders = getPromptOrders(data);
    const orderedIds = [];
    const seen = new Set();
    const missingIds = [];
    const enabledMap = new Map();

    for (const group of orders) {
      for (const item of group.order) {
        const id = item?.identifier;
        if (!id) continue;
        if (!enabledMap.has(id)) enabledMap.set(id, !!item.enabled);
        if (!byId.has(id)) {
          missingIds.push(id);
          continue;
        }
        if (!seen.has(id)) {
          seen.add(id);
          orderedIds.push(id);
        }
      }
    }

    // Preserve prompts that are not present in prompt_order, appended unchanged.
    const orphans = prompts.filter(p => p?.identifier && !seen.has(p.identifier)).map(p => p.identifier);
    const reordered = [];
    for (const id of orderedIds) reordered.push(byId.get(id));
    for (const p of prompts) {
      if (!p?.identifier || !seen.has(p.identifier)) reordered.push(p);
    }

    // Deep clone so the source object is never modified in memory.
    const result = typeof structuredClone === 'function' ? structuredClone(data) : JSON.parse(JSON.stringify(data));
    result.prompts = reordered;

    return {
      result,
      stats: {
        original: prompts.length,
        reordered: reordered.length,
        orderedCount: orderedIds.length,
        orphanCount: orphans.length,
        missingCount: missingIds.length,
        duplicateCount: duplicateIds.length,
        groups: orders.length,
      },
      missingIds,
      duplicateIds,
      orphans,
    };
  }

  // Minimal ZIP reader using the browser's built-in DEFLATE stream.
  async function readZip(file) {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const dv = new DataView(buf);
    const u32 = o => dv.getUint32(o, true);
    const u16 = o => dv.getUint16(o, true);

    let eocd = -1;
    const min = Math.max(0, bytes.length - 0xFFFF - 22);
    for (let i = bytes.length - 22; i >= min; i--) {
      if (u32(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的 ZIP 文件，或 ZIP 使用了暂不支持的格式。');

    const count = u16(eocd + 10);
    const cdOffset = u32(eocd + 16);
    const files = [];
    let p = cdOffset;

    for (let i = 0; i < count; i++) {
      if (u32(p) !== 0x02014b50) throw new Error('ZIP 中央目录损坏。');
      const method = u16(p + 10);
      const compressedSize = u32(p + 20);
      const uncompressedSize = u32(p + 24);
      const nameLen = u16(p + 28);
      const extraLen = u16(p + 30);
      const commentLen = u16(p + 32);
      const localOffset = u32(p + 42);
      const name = new TextDecoder().decode(bytes.slice(p + 46, p + 46 + nameLen));
      files.push({ name, method, compressedSize, uncompressedSize, localOffset });
      p += 46 + nameLen + extraLen + commentLen;
    }

    async function extract(entry) {
      if (entry.name.endsWith('/')) return new Uint8Array();
      const o = entry.localOffset;
      if (u32(o) !== 0x04034b50) throw new Error(`ZIP 本地文件头损坏：${entry.name}`);
      const nameLen = u16(o + 26);
      const extraLen = u16(o + 28);
      const start = o + 30 + nameLen + extraLen;
      const comp = bytes.slice(start, start + entry.compressedSize);
      if (entry.method === 0) return comp;
      if (entry.method !== 8) throw new Error(`暂不支持 ZIP 压缩方式 ${entry.method}：${entry.name}`);
      if (typeof DecompressionStream === 'undefined') throw new Error('当前 WebView 不支持 ZIP 解压。');
      const stream = new Blob([comp]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }

    return { entries: files, extract };
  }

  function detectZipPlugin(entries) {
    const files = entries.filter(x => !x.name.endsWith('/'));
    const manifests = files.filter(x => /(^|\/)manifest\.json$/i.test(x.name));
    if (!manifests.length) return { valid: false, reason: '未找到 manifest.json：看起来不是标准酒馆前端扩展。' };
    const manifestPath = manifests[0].name;
    const parts = manifestPath.split('/');
    const root = parts.length > 1 ? parts.slice(0, -1).join('/') + '/' : '';
    return { valid: true, root, manifestPath, fileCount: files.length };
  }

  function render() {
    if (!document.body || $('#ttb-root')) return;
    const root = document.createElement('div');
    root.id = 'ttb-root';
    root.innerHTML = `
      <button id="ttb-open" class="ttb-open" title="小众工具箱">🧰</button>
      <div id="ttb-modal" class="ttb-modal" hidden>
        <div class="ttb-panel" role="dialog" aria-modal="true" aria-label="小众工具箱">
          <div class="ttb-head">
            <strong>小众工具箱</strong>
            <button class="ttb-icon" id="ttb-close" aria-label="关闭">×</button>
          </div>
          <div class="ttb-body">
            <section class="ttb-section">
              <div class="ttb-section-head"><span>📋 预设 JSON 整理</span><span class="ttb-hint">只处理你手动导入的副本</span></div>
              <label class="ttb-drop" id="ttb-preset-drop">
                <input id="ttb-preset-file" type="file" accept=".json,application/json" hidden>
                <span>选择预设 JSON</span><small id="ttb-preset-name">未选择文件</small>
              </label>
              <label class="ttb-check"><input id="ttb-preset-organize" type="checkbox" checked> 按酒馆实际拼装顺序整理 <code>prompts[]</code></label>
              <div id="ttb-preset-info" class="ttb-result" hidden></div>
              <div class="ttb-actions">
                <button id="ttb-preset-run" disabled>整理</button>
                <button id="ttb-preset-export" disabled>导出新 JSON</button>
              </div>
            </section>

            <section class="ttb-section">
              <div class="ttb-section-head"><span>🖼️ 图片格式转换</span><span class="ttb-hint">默认 PNG</span></div>
              <label class="ttb-drop" id="ttb-image-drop">
                <input id="ttb-image-file" type="file" accept="image/*" hidden>
                <span>导入需要转换的图片</span><small id="ttb-image-name">未选择图片</small>
              </label>
              <div class="ttb-row">
                <label>输出格式
                  <select id="ttb-image-format"><option value="png">PNG</option><option value="jpeg">JPEG</option><option value="webp">WebP</option></select>
                </label>
                <button id="ttb-image-run" disabled>转换</button>
              </div>
              <div id="ttb-image-result" class="ttb-image-result" hidden></div>
            </section>

            <section class="ttb-section">
              <div class="ttb-section-head"><span>📦 插件 ZIP 导入</span><span class="ttb-hint">第一版先做安全检查</span></div>
              <label class="ttb-drop" id="ttb-zip-drop">
                <input id="ttb-zip-file" type="file" accept=".zip,application/zip" hidden>
                <span>选择插件 ZIP</span><small id="ttb-zip-name">未选择文件</small>
              </label>
              <div id="ttb-zip-result" class="ttb-result" hidden></div>
              <div class="ttb-actions"><button id="ttb-zip-export" disabled>导出检查结果</button></div>
            </section>

            <section class="ttb-section ttb-muted-section">
              <div class="ttb-section-head"><span>🧹 清理维护</span><span class="ttb-hint">安全扫描版</span></div>
              <div class="ttb-actions"><button id="ttb-scan">扫描可清理项目</button><button id="ttb-backup">七天备份</button></div>
              <div id="ttb-clean-result" class="ttb-result" hidden></div>
            </section>
          </div>
        </div>
      </div>`;
    document.body.appendChild(root);
    bindEvents();
  }

  function openModal() { $('#ttb-modal').hidden = false; }
  function closeModal() { $('#ttb-modal').hidden = true; }

  async function onPreset(file) {
    try {
      const raw = await readTextFile(file);
      const parsed = JSON.parse(raw);
      const organized = organizePreset(parsed);
      state.preset = parsed;
      state.presetResult = organized;
      $('#ttb-preset-name').textContent = file.name;
      $('#ttb-preset-run').disabled = false;
      $('#ttb-preset-export').disabled = false;
      const s = organized.stats;
      $('#ttb-preset-info').hidden = false;
      $('#ttb-preset-info').innerHTML = `读取成功：${s.original} 条 prompts，找到 ${s.orderedCount} 条实际排序记录，${s.groups} 个排序组。${s.orphanCount ? `另有 ${s.orphanCount} 条未出现在 prompt_order 中，会保持在末尾。` : ''}${s.missingCount ? `<br><strong>发现 ${s.missingCount} 个排序 ID 找不到对应 prompt，已跳过，不强行修复。</strong>` : ''}`;
    } catch (e) {
      state.preset = null; state.presetResult = null;
      $('#ttb-preset-run').disabled = true; $('#ttb-preset-export').disabled = true;
      $('#ttb-preset-info').hidden = false;
      $('#ttb-preset-info').textContent = e.message;
      toast(e.message, 'error');
    }
  }

  function exportPreset() {
    if (!state.presetResult) return;
    const base = 'preset';
    const blob = new Blob([JSON.stringify(state.presetResult.result, null, 2)], { type: 'application/json;charset=utf-8' });
    downloadBlob(blob, base.replace(/\.json$/i, '') + '.organized.json');
  }

  async function onImage(file) {
    try {
      state.imageBlob = null;
      state.imageName = file.name;
      $('#ttb-image-name').textContent = `${file.name} (${Math.round(file.size / 1024)} KB)`;
      $('#ttb-image-run').disabled = false;
      const dataUrl = await blobToDataURL(file);
      $('#ttb-image-result').hidden = false;
      $('#ttb-image-result').innerHTML = `<img src="${dataUrl}" alt="预览"><span>已加载，选择输出格式后点击「转换」。</span>`;
    } catch (e) { toast(e.message, 'error'); }
  }

  async function runImage() {
    const input = $('#ttb-image-file');
    const file = input.files?.[0];
    if (!file) return;
    try {
      const format = $('#ttb-image-format').value;
      const out = await convertImage(file, format);
      state.imageBlob = out.blob;
      const ext = format === 'jpeg' ? 'jpg' : format;
      const name = file.name.replace(/\.[^.]+$/, '') + '.' + ext;
      const url = URL.createObjectURL(out.blob);
      $('#ttb-image-result').hidden = false;
      $('#ttb-image-result').innerHTML = `<img src="${url}" alt="转换后预览"><div>${out.width} × ${out.height} · ${format.toUpperCase()} · ${Math.round(out.blob.size / 1024)} KB</div><button id="ttb-image-export">导出图片</button>`;
      $('#ttb-image-export').onclick = () => downloadBlob(state.imageBlob, name);
    } catch (e) { toast(e.message, 'error'); }
  }

  async function onZip(file) {
    try {
      if (file.size > 50 * 1024 * 1024) throw new Error('ZIP 超过 50 MB，第一版拒绝处理。');
      const zip = await readZip(file);
      const info = detectZipPlugin(zip.entries);
      state.zipFiles = zip.entries;
      state.zipRoot = info.root || '';
      $('#ttb-zip-name').textContent = `${file.name} (${Math.round(file.size / 1024)} KB)`;
      $('#ttb-zip-result').hidden = false;
      if (!info.valid) {
        $('#ttb-zip-result').textContent = info.reason;
        $('#ttb-zip-export').disabled = true;
        return;
      }
      const unsafe = zip.entries.filter(e => /(^|\/)\.\.?\//.test(e.name) || e.name.startsWith('/') || /^[A-Za-z]:[\\/]/.test(e.name));
      $('#ttb-zip-result').innerHTML = `发现 manifest.json：<code>${escapeHtml(info.manifestPath)}</code><br>文件数：${info.fileCount}${unsafe.length ? `<br><strong>发现 ${unsafe.length} 个可疑路径，禁止进一步处理。</strong>` : '<br>路径检查通过。'}<br><small>第一版不直接写入 TauriTavern 扩展目录，避免在 iOS/桌面端误写文件；可继续加入宿主文件 API 后再开启“一键安装”。</small>`;
      $('#ttb-zip-export').disabled = !!unsafe.length;
      $('#ttb-zip-export').onclick = () => downloadBlob(file, 'checked-' + file.name);
    } catch (e) {
      $('#ttb-zip-result').hidden = false;
      $('#ttb-zip-result').textContent = e.message;
      $('#ttb-zip-export').disabled = true;
      toast(e.message, 'error');
    }
  }

  async function mountSettingsEntry() {
    try {
      if (document.getElementById('tauritavernToolboxSettings')) return;
      const base = 'scripts/extensions/third-party/tauritavern-toolbox';
      const response = await fetch(`${base}/settings.html`);
      if (!response.ok) throw new Error(`无法加载扩展设置：HTTP ${response.status}`);
      const html = await response.text();
      const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
      if (!host) {
        console.warn('[小众工具箱] 扩展设置容器尚未出现。');
        return;
      }
      host.insertAdjacentHTML('beforeend', html);
      document.getElementById('ttb-settings-open')?.addEventListener('click', openModal);
    } catch (e) {
      console.warn('[小众工具箱] 设置入口加载失败：', e);
    }
  }

  function bindEvents() {
    $('#ttb-open').onclick = openModal;
    $('#ttb-close').onclick = closeModal;
    $('#ttb-modal').addEventListener('click', e => { if (e.target.id === 'ttb-modal') closeModal(); });
    $('#ttb-preset-file').onchange = e => e.target.files[0] && onPreset(e.target.files[0]);
    $('#ttb-preset-run').onclick = () => toast('整理已在内存中完成；原 JSON 没有被修改。');
    $('#ttb-preset-export').onclick = exportPreset;
    $('#ttb-image-file').onchange = e => e.target.files[0] && onImage(e.target.files[0]);
    $('#ttb-image-run').onclick = runImage;
    $('#ttb-zip-file').onchange = e => e.target.files[0] && onZip(e.target.files[0]);
    $('#ttb-scan').onclick = () => { $('#ttb-clean-result').hidden = false; $('#ttb-clean-result').textContent = '第一版暂不自动扫描数据目录；会在宿主文件 API 确认后接入。'; };
    $('#ttb-backup').onclick = () => toast('七天备份入口已预留。第一版不复制或删除 TauriTavern 原生备份数据。');
  }

  async function init() {
    try {
      await (window.__TAURITAVERN__?.ready ?? window.__TAURITAVERN_MAIN_READY__);
    } catch (_) {}
    const start = async () => {
      render();
      await mountSettingsEntry();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else await start();
  }

  init();
})();

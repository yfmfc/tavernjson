/**
 * TauriTavern 小众工具箱核心驱动脚本
 * 兼容 SillyTavern 1.18.0 前端规范与 TauriTavern 本地桌面架构
 */

// 动态载入 JSZip（用于纯前端解压与 ZIP 内容比对）
async function ensureJSZip() {
    if (window.JSZip) return window.JSZip;
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
        script.onload = () => resolve(window.JSZip);
        script.onerror = () => reject(new Error('无法加载 JSZip 组件'));
        document.head.appendChild(script);
    });
}

(function () {
    // 基础分类定义
    const CATEGORIES = {
        lorebooks: { id: 'lorebooks', icon: '📚', name: '遗留世界书', items: [] },
        chats: { id: 'chats', icon: '🗨️', name: '聊天记录', items: [] },
        caches: { id: 'caches', icon: '💾', name: 'Cache Storage', items: [] },
        localStorage: { id: 'localStorage', icon: '🗄', name: 'LocalStorage', items: [] },
        sessionStorage: { id: 'sessionStorage', icon: '🗄', name: 'SessionStorage', items: [] },
        indexedDB: { id: 'indexedDB', icon: '🗄', name: 'IndexedDB', items: [] },
        tempFiles: { id: 'tempFiles', icon: '📂', name: '临时文件', items: [] },
        appCache: { id: 'appCache', icon: '🧹', name: '应用缓存', items: [] }
    };

    // 全局勾选状态记录：category -> Set of item keys
    const selectedState = {};
    Object.keys(CATEGORIES).forEach(k => selectedState[k] = new Set());

    // 状态保持
    let loadedImageFile = null;
    let convertedImageBlob = null;
    let loadedPresetData = null;
    let formattedPresetText = null;
    let pendingZipData = null;

    /**
     * 初始化主渲染逻辑
     */
    async function initPlugin() {
        renderCategoryCards();
        bindNavigationTabs();
        bindCleanerControls();
        bindInstallerControls();
        bindImageControls();
        bindPresetControls();
    }

    /* ─────────────────────────────────────────────────────────────
       功能一：清理维护 (Cleaner & Scanner Engine)
       ───────────────────────────────────────────────────────────── */

    function renderCategoryCards() {
        const wrapper = document.getElementById('nt-categories-wrapper');
        if (!wrapper) return;
        wrapper.innerHTML = '';

        Object.values(CATEGORIES).forEach(cat => {
            const card = document.createElement('div');
            card.className = 'nt-category';
            card.id = `nt-cat-card-${cat.id}`;
            card.innerHTML = `
                <div class="nt-category-header">
                    <div class="nt-category-title">
                        <span>${cat.icon}</span>
                        <span>${cat.name}</span>
                        <span class="nt-badge" id="nt-badge-${cat.id}">0</span>
                    </div>
                    <div class="nt-btn-group">
                        <button class="nt-btn" data-action="select-cat" data-cat="${cat.id}">全选</button>
                        <button class="nt-btn" data-action="deselect-cat" data-cat="${cat.id}">取消全选</button>
                        <button class="nt-btn" data-action="toggle-cat" data-cat="${cat.id}">展开</button>
                    </div>
                </div>
                <div class="nt-item-list" id="nt-list-${cat.id}"></div>
            `;
            wrapper.appendChild(card);
        });

        // 统一绑定分类头部按键（支持不展开列表即执行全选/取消）
        wrapper.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-action]');
            if (!btn) return;
            const action = btn.getAttribute('data-action');
            const catId = btn.getAttribute('data-cat');

            if (action === 'select-cat') {
                CATEGORIES[catId].items.forEach(item => selectedState[catId].add(item.id));
                syncCategorySelectionUI(catId);
            } else if (action === 'deselect-cat') {
                selectedState[catId].clear();
                syncCategorySelectionUI(catId);
            } else if (action === 'toggle-cat') {
                const card = document.getElementById(`nt-cat-card-${catId}`);
                card.classList.toggle('expanded');
                btn.textContent = card.classList.contains('expanded') ? '折叠' : '展开';
            }
            updateTotalBadge();
        });
    }

    function syncCategorySelectionUI(catId) {
        const listEl = document.getElementById(`nt-list-${catId}`);
        if (!listEl) return;
        const checkboxes = listEl.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(cb => {
            cb.checked = selectedState[catId].has(cb.value);
        });
    }

    function updateTotalBadge() {
        let totalSelected = 0;
        let totalItems = 0;
        Object.keys(CATEGORIES).forEach(k => {
            totalSelected += selectedState[k].size;
            totalItems += CATEGORIES[k].items.length;
            const badge = document.getElementById(`nt-badge-${k}`);
            if (badge) badge.textContent = CATEGORIES[k].items.length;
        });
        const totalCountEl = document.getElementById('nt-total-clean-count');
        if (totalCountEl) totalCountEl.textContent = `全部可清理项 (${totalItems}) [已选 ${totalSelected}]`;
    }

    /**
     * 核心扫描逻辑
     */
    async function executeFullScan() {
        const btnScan = document.getElementById('nt-btn-scan-all');
        btnScan.disabled = true;
        btnScan.textContent = '正在深入扫描本地数据...';

        try {
            // 清理旧状态
            Object.keys(CATEGORIES).forEach(k => {
                CATEGORIES[k].items = [];
                selectedState[k].clear();
            });

            // 1. 扫描 World Info (世界书) 与关联性分析
            await scanWorldInfos();

            // 2. 扫描聊天记录 (根据过期时间)
            await scanChatLogs();

            // 3. 扫描浏览器/Web存储
            await scanWebStorage();

            // 4. 扫描缓存与临时目录
            await scanCachesAndTemp();

            // 渲染所有子项列表
            Object.values(CATEGORIES).forEach(cat => renderItemList(cat.id));
            updateTotalBadge();
            toastr.success(`扫描完成，共识别出 ${Object.values(CATEGORIES).reduce((a, c) => a + c.items.length, 0)} 项本地数据。`);
        } catch (err) {
            console.error('[NicheToolbox] 扫描失败', err);
            toastr.error('扫描过程中出现异常: ' + err.message);
        } finally {
            btnScan.disabled = false;
            btnScan.textContent = '🔍 开始全面扫描';
        }
    }

    async function scanWorldInfos() {
        const context = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
        let allWorldNames = [];
        try {
            const resp = await fetch('/api/worldinfo/get', { credentials: 'same-origin' });
            if (resp.ok) {
                const data = await resp.json();
                allWorldNames = Array.isArray(data) ? data : Object.keys(data);
            }
        } catch (_) {
            allWorldNames = (context && context.worldInfo) ? Object.keys(context.worldInfo) : [];
        }

        // 提取全量引用源
        const referencedBooks = new Set();

        // (1) 全局绑定
        if (context && context.settings && Array.isArray(context.settings.world_names)) {
            context.settings.world_names.forEach(n => referencedBooks.add(n));
        }

        // (2) 角色卡绑定 (包括内嵌和外挂)
        if (context && Array.isArray(context.characters)) {
            context.characters.forEach(c => {
                if (c.world) referencedBooks.add(c.world);
                if (c.data && c.data.character_book && c.data.character_book.name) referencedBooks.add(c.data.character_book.name);
                if (c.data && c.data.extensions && c.data.extensions.world) referencedBooks.add(c.data.extensions.world);
            });
        }

        // (3) Persona 设定集绑定
        if (context && context.personas) {
            Object.values(context.personas).forEach(p => {
                if (p && p.world) referencedBooks.add(p.world);
            });
        }

        CATEGORIES.lorebooks.items = allWorldNames.map(name => {
            const isRef = referencedBooks.has(name);
            return {
                id: name,
                title: name,
                type: isRef ? '正在使用' : '未发现有效引用',
                badgeClass: isRef ? 'active' : 'orphan',
                extra: isRef ? '被角色/设定集正常引用' : '无角色卡或全局引用（孤儿世界书）'
            };
        });
    }

    async function scanChatLogs() {
        const daysFilter = document.getElementById('nt-chat-filter').value;
        const now = Date.now();
        const thresholdMs = daysFilter === 'all' ? Infinity : parseInt(daysFilter, 10) * 86400000;

        const context = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
        const characters = (context && context.characters) ? context.characters : [];

        const chatItems = [];
        for (const char of characters) {
            try {
                const resp = await fetch('/api/characters/chats', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ avatar_url: char.avatar }),
                    credentials: 'same-origin'
                });
                if (!resp.ok) continue;
                const chats = await resp.json();
                Object.entries(chats).forEach(([chatFile, meta]) => {
                    const lastTime = meta && meta.last_mes ? meta.last_mes : 0;
                    const isOlder = (now - lastTime) >= thresholdMs || daysFilter === 'all';
                    if (isOlder) {
                        chatItems.push({
                            id: `${char.avatar}::${chatFile}`,
                            title: `${char.name} - ${chatFile.replace('.jsonl', '')}`,
                            type: '角色聊天',
                            badgeClass: 'active',
                            extra: lastTime ? `最后更新: ${new Date(lastTime).toLocaleDateString()}` : '无最新消息'
                        });
                    }
                });
            } catch (_) {}
        }
        CATEGORIES.chats.items = chatItems;
    }

    async function scanWebStorage() {
        // Cache Storage
        if ('caches' in window) {
            try {
                const cacheNames = await window.caches.keys();
                CATEGORIES.caches.items = cacheNames.map(n => ({
                    id: n,
                    title: n,
                    type: 'Cache Storage',
                    badgeClass: 'active',
                    extra: '静态资源缓存包'
                }));
            } catch (_) {}
        }

        // LocalStorage
        const lsKeys = Object.keys(localStorage);
        CATEGORIES.localStorage.items = lsKeys.map(k => ({
            id: k,
            title: k,
            type: 'LocalStorage',
            badgeClass: 'active',
            extra: `大小: ~${(localStorage.getItem(k) || '').length} 字符`
        }));

        // SessionStorage
        const ssKeys = Object.keys(sessionStorage);
        CATEGORIES.sessionStorage.items = ssKeys.map(k => ({
            id: k,
            title: k,
            type: 'SessionStorage',
            badgeClass: 'active',
            extra: `大小: ~${(sessionStorage.getItem(k) || '').length} 字符`
        }));

        // IndexedDB
        if (window.indexedDB && indexedDB.databases) {
            try {
                const dbs = await indexedDB.databases();
                CATEGORIES.indexedDB.items = dbs.map(db => ({
                    id: db.name,
                    title: db.name,
                    type: `v${db.version}`,
                    badgeClass: 'active',
                    extra: '本地结构化数据库'
                }));
            } catch (_) {}
        }
    }

    async function scanCachesAndTemp() {
        // 尝试从 Tauri 或 SillyTavern 后端缓存探测
        try {
            const resp = await fetch('/api/cache/list', { credentials: 'same-origin' });
            if (resp.ok) {
                const files = await resp.json();
                CATEGORIES.tempFiles.items = (files.temp || []).map(f => ({
                    id: f.path || f.name,
                    title: f.name,
                    type: '临时文件',
                    badgeClass: 'unknown',
                    extra: f.size ? `${(f.size / 1024).toFixed(1)} KB` : ''
                }));
                CATEGORIES.appCache.items = (files.cache || []).map(f => ({
                    id: f.path || f.name,
                    title: f.name,
                    type: '应用缓存',
                    badgeClass: 'unknown',
                    extra: f.size ? `${(f.size / 1024).toFixed(1)} KB` : ''
                }));
            }
        } catch (_) {}
    }

    function renderItemList(catId) {
        const listEl = document.getElementById(`nt-list-${catId}`);
        if (!listEl) return;
        listEl.innerHTML = '';
        const items = CATEGORIES[catId].items;

        if (items.length === 0) {
            listEl.innerHTML = '<div style="color: #718096; font-size: 12px; padding: 4px;">暂无可清理项</div>';
            return;
        }

        items.forEach(item => {
            const row = document.createElement('div');
            row.className = 'nt-item-row';
            row.innerHTML = `
                <div class="nt-item-info">
                    <input type="checkbox" value="${item.id}" ${selectedState[catId].has(item.id) ? 'checked' : ''} />
                    <span title="${item.title}">${item.title}</span>
                    <span class="nt-badge ${item.badgeClass}">${item.type}</span>
                </div>
                <div style="color: #a0aec0; font-size: 11px;">${item.extra || ''}</div>
            `;

            const cb = row.querySelector('input[type="checkbox"]');
            cb.addEventListener('change', (e) => {
                if (e.target.checked) {
                    selectedState[catId].add(item.id);
                } else {
                    selectedState[catId].delete(item.id);
                }
                updateTotalBadge();
            });

            listEl.appendChild(row);
        });
    }

    function bindCleanerControls() {
        document.getElementById('nt-btn-scan-all').addEventListener('click', executeFullScan);

        // 全局全选 / 取消全选
        document.getElementById('nt-btn-global-select').addEventListener('click', () => {
            Object.keys(CATEGORIES).forEach(catId => {
                CATEGORIES[catId].items.forEach(it => selectedState[catId].add(it.id));
                syncCategorySelectionUI(catId);
            });
            updateTotalBadge();
        });

        document.getElementById('nt-btn-global-deselect').addEventListener('click', () => {
            Object.keys(CATEGORIES).forEach(catId => {
                selectedState[catId].clear();
                syncCategorySelectionUI(catId);
            });
            updateTotalBadge();
        });

        // 统一清理执行
        document.getElementById('nt-btn-batch-delete').addEventListener('click', async () => {
            let totalToDel = 0;
            Object.keys(selectedState).forEach(k => totalToDel += selectedState[k].size);
            if (totalToDel === 0) {
                toastr.warning('当前未勾选任何清理项目');
                return;
            }

            if (!confirm(`确定要永久清理已勾选的 ${totalToDel} 项本地数据吗？此操作不可逆！`)) return;

            // 1. 删除世界书
            for (const name of selectedState.lorebooks) {
                try {
                    await fetch('/api/worldinfo/delete', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name }),
                        credentials: 'same-origin'
                    });
                } catch (_) {}
            }

            // 2. 删除聊天记录
            for (const ref of selectedState.chats) {
                const [avatar, chat] = ref.split('::');
                try {
                    await fetch('/api/chats/delete', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ avatar_url: avatar, chat }),
                        credentials: 'same-origin'
                    });
                } catch (_) {}
            }

            // 3. 删除 Cache Storage
            for (const cName of selectedState.caches) {
                if ('caches' in window) await window.caches.delete(cName);
            }

            // 4. 删除 LocalStorage & SessionStorage
            selectedState.localStorage.forEach(k => localStorage.removeItem(k));
            selectedState.sessionStorage.forEach(k => sessionStorage.removeItem(k));

            // 5. 删除 IndexedDB
            for (const dbName of selectedState.indexedDB) {
                if (window.indexedDB) window.indexedDB.deleteDatabase(dbName);
            }

            toastr.success(`清理完成，成功移除 ${totalToDel} 个数据对象。`);
            await executeFullScan();
        });
    }

    /* ─────────────────────────────────────────────────────────────
       功能二：本地 ZIP 扩展导入 (Installer Engine)
       ───────────────────────────────────────────────────────────── */

    function bindInstallerControls() {
        const dropzone = document.getElementById('nt-zip-dropzone');
        const input = document.getElementById('nt-zip-input');
        const infoBox = document.getElementById('nt-ext-info');
        const btnInstall = document.getElementById('nt-btn-install-ext');

        dropzone.addEventListener('click', () => input.click());
        dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.style.borderColor = '#63b3ed'; });
        dropzone.addEventListener('dragleave', () => { dropzone.style.borderColor = '#4a5568'; });
        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.style.borderColor = '#4a5568';
            if (e.dataTransfer.files.length) handleZipFile(e.dataTransfer.files[0]);
        });
        input.addEventListener('change', (e) => {
            if (e.target.files.length) handleZipFile(e.target.files[0]);
        });

        async function handleZipFile(file) {
            try {
                const JSZipLib = await ensureJSZip();
                const zip = await JSZipLib.loadAsync(file);

                // 定位 manifest.json
                let manifestPath = null;
                zip.forEach((relPath) => {
                    if (relPath.endsWith('manifest.json') && !manifestPath) {
                        manifestPath = relPath;
                    }
                });

                if (!manifestPath) {
                    toastr.error('ZIP 中未找到 manifest.json，非合法前端扩展！');
                    return;
                }

                const manifestContent = await zip.file(manifestPath).async('string');
                const manifest = JSON.parse(manifestContent);

                // 计算根目录偏移行
                const baseDir = manifestPath.includes('/') ? manifestPath.substring(0, manifestPath.lastIndexOf('/') + 1) : '';
                const detectedFolder = manifest.name || file.name.replace(/\.zip$/i, '');

                pendingZipData = {
                    file,
                    zip,
                    manifest,
                    baseDir,
                    folderName: detectedFolder
                };

                // UI 展示
                infoBox.style.display = 'block';
                document.getElementById('nt-ext-name').textContent = manifest.display_name || manifest.name;
                document.getElementById('nt-ext-folder').textContent = detectedFolder;
                document.getElementById('nt-ext-version').textContent = manifest.version || '1.0.0';
                document.getElementById('nt-ext-status').textContent = '已解析有效扩展结构，准备就绪';
                btnInstall.style.display = 'inline-flex';
            } catch (err) {
                console.error(err);
                toastr.error('解析 ZIP 文件失败: ' + err.message);
            }
        }

        btnInstall.addEventListener('click', async () => {
            if (!pendingZipData) return;
            const scope = document.getElementById('nt-ext-scope').value;
            btnInstall.disabled = true;
            btnInstall.textContent = '正在部署扩展文件...';

            try {
                // 读取全部文件准备写入
                const entries = [];
                for (const [path, zipEntry] of Object.entries(pendingZipData.zip.files)) {
                    if (zipEntry.dir) continue;
                    if (pendingZipData.baseDir && !path.startsWith(pendingZipData.baseDir)) continue;

                    const targetRelPath = pendingZipData.baseDir ? path.substring(pendingZipData.baseDir.length) : path;
                    const contentBase64 = await zipEntry.async('base64');
                    entries.push({ path: targetRelPath, content: contentBase64 });
                }

                // 提交给后端或 Tauri 桥接层统一写入
                const payload = {
                    scope, // 'global' 或 'local'
                    folderName: pendingZipData.folderName,
                    files: entries
                };

                const resp = await fetch('/api/extensions/install-zip', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    credentials: 'same-origin'
                });

                if (!resp.ok) {
                    throw new Error('扩展写入接口返回状态: ' + resp.status);
                }

                toastr.success('扩展安装/替换成功！TauriTavern 即将自动刷新生效...');
                setTimeout(() => {
                    window.location.reload();
                }, 1500);
            } catch (err) {
                console.error(err);
                toastr.error('扩展安装失败: ' + err.message);
                btnInstall.disabled = false;
                btnInstall.textContent = '重新尝试安装';
            }
        });
    }

    /* ─────────────────────────────────────────────────────────────
       功能三：图片格式转换 (Image Converter Engine)
       ───────────────────────────────────────────────────────────── */

    function bindImageControls() {
        const dropzone = document.getElementById('nt-img-dropzone');
        const input = document.getElementById('nt-img-input');
        const formatSelect = document.getElementById('nt-img-target-format');
        const qualityWrapper = document.getElementById('nt-quality-wrapper');
        const pngOptWrapper = document.getElementById('nt-png-opt-wrapper');
        const qualitySlider = document.getElementById('nt-img-quality');
        const qualityVal = document.getElementById('nt-quality-val');
        const btnConvert = document.getElementById('nt-btn-convert-img');
        const btnDownload = document.getElementById('nt-btn-download-img');

        dropzone.addEventListener('click', () => input.click());
        input.addEventListener('change', (e) => {
            if (e.target.files.length) {
                loadedImageFile = e.target.files[0];
                btnConvert.disabled = false;
                document.getElementById('nt-img-orig-size').textContent = (loadedImageFile.size / 1024 / 1024).toFixed(2) + ' MB';
                toastr.info(`已载入图片: ${loadedImageFile.name}`);
            }
        });

        qualitySlider.addEventListener('input', () => {
            qualityVal.textContent = qualitySlider.value;
        });

        formatSelect.addEventListener('change', () => {
            if (formatSelect.value === 'image/png') {
                qualityWrapper.style.display = 'none';
                pngOptWrapper.style.display = 'flex';
            } else {
                qualityWrapper.style.display = 'flex';
                pngOptWrapper.style.display = 'none';
            }
        });

        btnConvert.addEventListener('click', async () => {
            if (!loadedImageFile) return;
            btnConvert.disabled = true;
            btnConvert.textContent = '正在转换...';

            try {
                const img = new Image();
                const fileUrl = URL.createObjectURL(loadedImageFile);
                await new Promise((res, rej) => {
                    img.onload = () => res();
                    img.onerror = rej;
                    img.src = fileUrl;
                });

                // 尺寸缩放计算
                const resizeRule = document.getElementById('nt-img-resize').value;
                let targetW = img.width;
                let targetH = img.height;

                if (resizeRule !== 'original') {
                    const maxEdge = parseInt(resizeRule, 10);
                    if (img.width > maxEdge || img.height > maxEdge) {
                        if (img.width >= img.height) {
                            targetW = maxEdge;
                            targetH = Math.round((img.height * maxEdge) / img.width);
                        } else {
                            targetH = maxEdge;
                            targetW = Math.round((img.width * maxEdge) / img.height);
                        }
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = targetW;
                canvas.height = targetH;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, targetW, targetH);

                const targetMime = formatSelect.value;
                const quality = parseInt(qualitySlider.value, 10) / 100;

                // 处理 PNG 颜色量化
                if (targetMime === 'image/png') {
                    const colorDepth = parseInt(document.getElementById('nt-png-colors').value, 10);
                    if (colorDepth > 0) {
                        applyColorQuantization(ctx, targetW, targetH, colorDepth);
                    }
                }

                canvas.toBlob((blob) => {
                    convertedImageBlob = blob;
                    URL.revokeObjectURL(fileUrl);

                    const outSizeMb = (blob.size / 1024 / 1024).toFixed(2);
                    const savedRatio = ((1 - blob.size / loadedImageFile.size) * 100).toFixed(1);

                    document.getElementById('nt-img-stats').style.display = 'block';
                    document.getElementById('nt-img-out-size').textContent = `${outSizeMb} MB (${(blob.size / 1024).toFixed(1)} KB)`;
                    document.getElementById('nt-img-ratio').textContent = `${savedRatio}% (体积缩减)`;

                    btnDownload.style.display = 'inline-flex';
                    btnConvert.disabled = false;
                    btnConvert.textContent = '开始转换';
                    toastr.success('图片转换处理完成！');
                }, targetMime, quality);
            } catch (err) {
                console.error(err);
                toastr.error('图片转换失败: ' + err.message);
                btnConvert.disabled = false;
                btnConvert.textContent = '开始转换';
            }
        });

        btnDownload.addEventListener('click', () => {
            if (!convertedImageBlob) return;
            const extMap = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };
            const ext = extMap[formatSelect.value] || 'png';
            const originalName = loadedImageFile.name.substring(0, loadedImageFile.name.lastIndexOf('.')) || 'image';
            const dlLink = document.createElement('a');
            dlLink.href = URL.createObjectURL(convertedImageBlob);
            dlLink.download = `${originalName}_optimized.${ext}`;
            dlLink.click();
            URL.revokeObjectURL(dlLink.href);
        });
    }

    /**
     * 针对 PNG 的简易调色板颜色量化（分箱采样算法）
     */
    function applyColorQuantization(ctx, width, height, colorsCount) {
        const imgData = ctx.getImageData(0, 0, width, height);
        const d = imgData.data;
        const step = Math.max(2, Math.floor(256 / Math.cbrt(colorsCount)));

        for (let i = 0; i < d.length; i += 4) {
            d[i] = Math.round(d[i] / step) * step;         // R
            d[i + 1] = Math.round(d[i + 1] / step) * step; // G
            d[i + 2] = Math.round(d[i + 2] / step) * step; // B
        }
        ctx.putImageData(imgData, 0, 0);
    }

    /* ─────────────────────────────────────────────────────────────
       功能四：Preset JSON 整理器 (Preset Organizer)
       ───────────────────────────────────────────────────────────── */

    function bindPresetControls() {
        const dropzone = document.getElementById('nt-preset-dropzone');
        const input = document.getElementById('nt-preset-input');
        const btnRun = document.getElementById('nt-btn-run-preset');
        const btnDownload = document.getElementById('nt-btn-download-preset');

        dropzone.addEventListener('click', () => input.click());
        input.addEventListener('change', (e) => {
            if (!e.target.files.length) return;
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = (evt) => {
                try {
                    loadedPresetData = JSON.parse(evt.target.result);
                    if (!loadedPresetData.prompts || !loadedPresetData.prompt_order) {
                        toastr.error('所选 JSON 缺少 prompts 或 prompt_order，非标准 Preset 文件！');
                        return;
                    }
                    btnRun.disabled = false;
                    toastr.info(`已载入 Preset: 识别到 ${loadedPresetData.prompts.length} 个条目`);
                } catch (err) {
                    toastr.error('无法解析 JSON 文件: ' + err.message);
                }
            };
            reader.readAsText(file);
        });

        btnRun.addEventListener('click', () => {
            if (!loadedPresetData) return;

            try {
                // 1. 提取 identifier 顺序
                const orderIds = loadedPresetData.prompt_order.map(it => {
                    return typeof it === 'string' ? it : (it.identifier || it.name);
                });

                // 2. 映射已有的 prompts 字典
                const promptMap = new Map();
                loadedPresetData.prompts.forEach(p => {
                    promptMap.set(p.identifier, p);
                });

                // 3. 严格按顺序重构 prompts
                const sortedPrompts = [];
                orderIds.forEach(id => {
                    if (promptMap.has(id)) {
                        sortedPrompts.push(promptMap.get(id));
                        promptMap.delete(id);
                    }
                });

                // 4. 将未在 prompt_order 中声明的条目追加至末尾（保护数据完整）
                promptMap.forEach(p => sortedPrompts.push(p));

                // 5. 替换排序结果，其余所有字段保持原封不动
                const finalObj = Object.assign({}, loadedPresetData, {
                    prompts: sortedPrompts
                });

                formattedPresetText = JSON.stringify(finalObj, null, 2);

                document.getElementById('nt-preset-result').style.display = 'block';
                document.getElementById('nt-preset-msg').textContent = `✓ 整理完成！共发现 ${sortedPrompts.length} 个提示词条目，已按 Preset 排序重新排列。`;
                btnDownload.style.display = 'inline-flex';
                toastr.success('Preset JSON 整理重构成功！');
            } catch (err) {
                toastr.error('整理发生异常: ' + err.message);
            }
        });

        btnDownload.addEventListener('click', () => {
            if (!formattedPresetText) return;
            const blob = new Blob([formattedPresetText], { type: 'application/json' });
            const dlLink = document.createElement('a');
            dlLink.href = URL.createObjectURL(blob);
            dlLink.download = 'preset_organized.json';
            dlLink.click();
            URL.revokeObjectURL(dlLink.href);
        });
    }

    /* ─────────────────────────────────────────────────────────────
       模块标签切换
       ───────────────────────────────────────────────────────────── */

    function bindNavigationTabs() {
        const tabs = document.querySelectorAll('.nt-tab-btn');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const targetId = tab.getAttribute('data-tab');

                document.querySelectorAll('.nt-section').forEach(sec => sec.style.display = 'none');
                const activeSec = document.getElementById(`nt-sec-${targetId}`);
                if (activeSec) activeSec.style.display = 'flex';
            });
        });
    }

    // 挂载到 SillyTavern / TauriTavern 扩展抽屉与面板
    jQuery(async () => {
        const htmlResp = await fetch('/scripts/extensions/third-party/tauritavern-niche-toolbox/index.html');
        const containerHtml = htmlResp.ok ? await htmlResp.text() : '';

        // 注册到扩展设置面板
        $('#extensions_settings').append(`
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>🧰 小众工具箱</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content" style="font-size:small;">
                    ${containerHtml}
                </div>
            </div>
        `);

        initPlugin();
    });
})();

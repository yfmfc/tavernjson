import { downloadBlob, formatBytes, escapeHtml } from './utils.js';
import { scanIdleChats, deleteChatItem } from './chatCleaner.js';
import { convertImage, extensionForFormat } from './imageConverter.js';
import { organizePreset, summarizePreset } from './presetOrganizer.js';

const MODULE_NAME = 'niche_toolbox';
// 必须和实际安装目录名一致，renderExtensionTemplateAsync 靠这个路径找 settings.html
const EXTENSION_FOLDER = 'third-party/niche-toolbox';

const DEFAULT_SETTINGS = Object.freeze({
    cleanupDays: 15,
    cleanupIncludeGroups: true,
    imageFormat: 'png',
    imageQuality: 0.8,
    imageMaxDimension: 2048,
});

function getSettings() {
    const { extensionSettings } = SillyTavern.getContext();
    if (!extensionSettings[MODULE_NAME]) {
        extensionSettings[MODULE_NAME] = structuredClone(DEFAULT_SETTINGS);
    }
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (!Object.hasOwn(extensionSettings[MODULE_NAME], key)) {
            extensionSettings[MODULE_NAME][key] = DEFAULT_SETTINGS[key];
        }
    }
    return extensionSettings[MODULE_NAME];
}

function saveSettings() {
    SillyTavern.getContext().saveSettingsDebounced();
}

// ============================================================
// 功能 1：聊天记录扫描清理
// ============================================================

let lastScanResults = [];

function renderCleanupList(items) {
    const $list = $('#nt_cleanup_list');
    $list.empty();

    if (items.length === 0) {
        $list.append('<div class="nt-hint">没有找到符合条件的闲置聊天</div>');
        return;
    }

    for (const item of items) {
        const dateStr = new Date(item.lastMesTs).toLocaleString();
        const typeLabel = item.type === 'group' ? '[群组]' : '[角色]';
        const disabledNote = item.isCurrentlyOpen ? '（当前正在使用，已跳过）' : '';
        const row = $(`
            <div class="nt-chat-item ${item.isCurrentlyOpen ? 'nt-disabled' : ''}">
                <input type="checkbox" class="nt-chat-checkbox" ${item.isCurrentlyOpen ? 'disabled' : ''} />
                <div class="nt-chat-meta">
                    <div class="nt-chat-title">${typeLabel} ${escapeHtml(item.name)} — ${escapeHtml(item.fileName)}</div>
                    <div class="nt-chat-sub">最后使用：${dateStr}　消息数：${item.mesCount ?? '未知'} ${disabledNote}</div>
                </div>
            </div>
        `);
        row.data('item', item);
        $list.append(row);
    }
}

async function handleScanClick() {
    const settings = getSettings();
    const days = Number($('#nt_cleanup_days').val());
    const includeGroups = $('#nt_cleanup_include_group').is(':checked');

    settings.cleanupDays = days;
    settings.cleanupIncludeGroups = includeGroups;
    saveSettings();

    if (!Number.isFinite(days) || days <= 0) {
        toastr.error('请输入一个大于 0 的天数');
        return;
    }

    const { loader } = SillyTavern.getContext();
    const handle = loader.show({ message: '正在扫描聊天记录……' });
    $('#nt_cleanup_status').text('扫描中……');

    try {
        lastScanResults = await scanIdleChats({ thresholdDays: days, includeGroups });
        renderCleanupList(lastScanResults);
        $('#nt_cleanup_status').text(`扫描完成，共找到 ${lastScanResults.length} 个超过 ${days} 天未使用的聊天`);
    } catch (err) {
        console.error('[NicheToolbox] 扫描失败', err);
        toastr.error('扫描失败，详情见控制台');
        $('#nt_cleanup_status').text('扫描失败');
    } finally {
        await handle.hide();
    }
}

function handleSelectAllClick() {
    $('#nt_cleanup_list .nt-chat-checkbox:not(:disabled)').prop('checked', true);
}

async function handleDeleteClick() {
    const checkedRows = $('#nt_cleanup_list .nt-chat-item').filter((_, el) => $(el).find('.nt-chat-checkbox').is(':checked'));

    if (checkedRows.length === 0) {
        toastr.warning('请先勾选要删除的聊天');
        return;
    }

    const { Popup } = SillyTavern.getContext();
    const confirmed = await Popup.show.confirm(
        '确认删除',
        `即将永久删除 ${checkedRows.length} 个聊天文件，此操作不可撤销，确定继续吗？`,
    );
    if (!confirmed) return;

    const { loader } = SillyTavern.getContext();
    const handle = loader.show({ message: '正在删除……' });

    let successCount = 0;
    let failCount = 0;

    for (const el of checkedRows.toArray()) {
        const item = $(el).data('item');
        const result = await deleteChatItem(item);
        if (result.ok) {
            successCount++;
            $(el).remove();
        } else {
            failCount++;
            console.error('[NicheToolbox] 删除失败', item, result);
        }
    }

    await handle.hide();

    if (failCount === 0) {
        toastr.success(`成功删除 ${successCount} 个聊天`);
    } else {
        toastr.warning(`成功删除 ${successCount} 个，失败 ${failCount} 个（详情见控制台，可能需要根据你的 ST/TauriTavern 版本调整删除接口的参数名）`);
    }

    $('#nt_cleanup_status').text(`删除完成：成功 ${successCount}，失败 ${failCount}`);
}

// ============================================================
// 功能 2：图片转换
// ============================================================

function renderImageParams(settings) {
    const format = $('#nt_img_format').val();
    const $params = $('#nt_img_params');
    $params.empty();

    if (format === 'png') {
        $params.append(`
            <div class="nt-row">
                <label for="nt_img_max_dim">最大边长（px）：</label>
                <input id="nt_img_max_dim" class="text_pole" type="number" min="16" style="max-width:100px;" value="${settings.imageMaxDimension}" />
                <span class="nt-hint">PNG 是无损格式，无法调质量，只能通过限制分辨率控制体积</span>
            </div>
        `);
        $('#nt_img_max_dim').on('change', () => {
            settings.imageMaxDimension = Number($('#nt_img_max_dim').val()) || DEFAULT_SETTINGS.imageMaxDimension;
            saveSettings();
        });
    } else {
        $params.append(`
            <div class="nt-row">
                <label for="nt_img_quality">质量（0~1）：</label>
                <input id="nt_img_quality" class="text_pole" type="number" min="0.1" max="1" step="0.05" style="max-width:100px;" value="${settings.imageQuality}" />
                <span class="nt-hint">数值越低体积越小，画质损失越大，建议 0.7~0.85</span>
            </div>
        `);
        $('#nt_img_quality').on('change', () => {
            const v = Number($('#nt_img_quality').val());
            settings.imageQuality = Number.isFinite(v) ? Math.min(1, Math.max(0.05, v)) : DEFAULT_SETTINGS.imageQuality;
            saveSettings();
        });
    }
}

async function handleConvertClick() {
    const settings = getSettings();
    const files = $('#nt_img_file_input')[0].files;

    if (!files || files.length === 0) {
        toastr.warning('请先选择要转换的图片');
        return;
    }

    const format = $('#nt_img_format').val();
    settings.imageFormat = format;
    saveSettings();

    const opts = format === 'png'
        ? { format, maxDimension: settings.imageMaxDimension }
        : { format, quality: settings.imageQuality };

    const $list = $('#nt_img_list');
    $list.empty();

    for (const file of Array.from(files)) {
        const row = $(`
            <div class="nt-img-row">
                <img />
                <div class="nt-img-meta">
                    <div>${escapeHtml(file.name)}</div>
                    <div class="nt-hint">转换中……</div>
                </div>
            </div>
        `);
        $list.append(row);

        try {
            const blob = await convertImage(file, opts);
            const previewUrl = URL.createObjectURL(blob);
            row.find('img').attr('src', previewUrl);

            const ext = extensionForFormat(format);
            const outName = file.name.replace(/\.[^.]+$/, '') + '.' + ext;

            row.find('.nt-hint').replaceWith(`
                <div>
                    原始大小：${formatBytes(file.size)} → 转换后：${formatBytes(blob.size)}
                    （${blob.size <= file.size ? '减少' : '增加'} ${Math.abs(Math.round((1 - blob.size / file.size) * 100))}%）
                </div>
                <input type="button" class="menu_button nt-img-download" value="下载 ${escapeHtml(outName)}" />
            `);
            row.find('.nt-img-download').on('click', () => downloadBlob(blob, outName));
        } catch (err) {
            console.error('[NicheToolbox] 图片转换失败', file.name, err);
            row.find('.nt-hint').text('转换失败：' + err.message);
        }
    }
}

// ============================================================
// 功能 3：Preset JSON 整理
// ============================================================

let loadedPreset = null;
let loadedPresetFileName = '';

function handlePresetFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
        try {
            loadedPreset = JSON.parse(reader.result);
            loadedPresetFileName = file.name;

            if (!Array.isArray(loadedPreset.prompts) || !Array.isArray(loadedPreset.prompt_order)) {
                throw new Error('这不是一个 Chat Completion 预设文件（缺少 prompts / prompt_order 字段）');
            }

            $('#nt_preset_summary').text(summarizePreset(loadedPreset));

            const $refSelect = $('#nt_preset_ref_select');
            $refSelect.empty();
            for (const entry of loadedPreset.prompt_order) {
                $refSelect.append(`<option value="${entry.character_id}">character_id = ${entry.character_id}${entry.character_id === 100000 ? '（默认）' : ''}</option>`);
            }
            $('#nt_preset_ref_row').show();
            $('#nt_preset_organize_btn').prop('disabled', false);
        } catch (err) {
            console.error('[NicheToolbox] 解析预设失败', err);
            toastr.error(err.message || '解析失败');
            $('#nt_preset_summary').text('');
            $('#nt_preset_organize_btn').prop('disabled', true);
            $('#nt_preset_ref_row').hide();
            loadedPreset = null;
        }
    };
    reader.readAsText(file, 'utf-8');
}

function handleOrganizeClick() {
    if (!loadedPreset) {
        toastr.warning('请先导入一个 preset JSON 文件');
        return;
    }

    try {
        const refCharacterId = Number($('#nt_preset_ref_select').val());
        const { preset, appendedCount } = organizePreset(loadedPreset, refCharacterId);

        const outName = loadedPresetFileName.replace(/\.json$/i, '') + '_organized.json';
        downloadBlob(JSON.stringify(preset, null, 4), outName, 'application/json');

        toastr.success(`整理完成并已导出${appendedCount > 0 ? `（其中 ${appendedCount} 个未在参照顺序中出现的 prompt 已追加到末尾）` : ''}`);
    } catch (err) {
        console.error('[NicheToolbox] 整理预设失败', err);
        toastr.error(err.message || '整理失败');
    }
}

// ============================================================
// 初始化
// ============================================================

async function init() {
    const context = SillyTavern.getContext();
    const settings = getSettings();

    const html = await context.renderExtensionTemplateAsync(EXTENSION_FOLDER, 'settings');
    $('#extensions_settings2').append(html);

    // ---- 功能1 初始值 & 事件 ----
    $('#nt_cleanup_days').val(settings.cleanupDays);
    $('#nt_cleanup_include_group').prop('checked', settings.cleanupIncludeGroups);
    $('#nt_cleanup_scan_btn').on('click', handleScanClick);
    $('#nt_cleanup_select_all').on('click', handleSelectAllClick);
    $('#nt_cleanup_delete_btn').on('click', handleDeleteClick);

    // ---- 功能2 初始值 & 事件 ----
    $('#nt_img_format').val(settings.imageFormat);
    renderImageParams(settings);
    $('#nt_img_format').on('change', () => {
        settings.imageFormat = $('#nt_img_format').val();
        saveSettings();
        renderImageParams(settings);
    });
    $('#nt_img_convert_btn').on('click', handleConvertClick);

    // ---- 功能3 事件 ----
    $('#nt_preset_file_input').on('change', handlePresetFileChange);
    $('#nt_preset_organize_btn').on('click', handleOrganizeClick);

    console.log('[NicheToolbox] 扩展已加载');
}

const { eventSource, event_types } = SillyTavern.getContext();
eventSource.on(event_types.APP_READY, init);

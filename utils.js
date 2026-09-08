// 通用工具函数，供三个功能模块共用

/**
 * 触发浏览器/Tauri WebView 内的文件下载（Blob + <a download>）
 * @param {Blob|string} content
 * @param {string} fileName
 * @param {string} [mimeType]
 */
export function downloadBlob(content, fileName, mimeType = 'application/octet-stream') {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // 延迟释放，避免部分 WebView 内核在 click 尚未完成时就吊销了 URL
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * 把字节数格式化成人类可读的大小
 * @param {number} bytes
 */
export function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return '未知大小';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * 尽量把 SillyTavern 聊天记录里的各种日期表示解析为毫秒时间戳。
 * ST 的 chat 时间字段历史上出现过好几种格式（issue #2151），
 * 这里做多重兜底：数字 -> 当作 epoch ms；否则交给 Date 解析。
 * @param {string|number|undefined} value
 * @returns {number|null} 毫秒时间戳，解析失败返回 null
 */
export function parseChatTimestamp(value) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    const asNumber = Number(value);
    if (Number.isFinite(asNumber) && String(value).trim() === String(asNumber)) {
        return asNumber;
    }
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
        return parsed;
    }
    return null;
}

/**
 * 简单的转义，避免把文件名/角色名当 HTML 插入时出问题
 * @param {string} str
 */
export function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

const MIME_MAP = {
    png: 'image/png',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
};

/**
 * 把一个 File 转换成指定格式的 Blob。
 * - PNG 本身无损，唯一能控制体积的手段是限制最大边长（maxDimension）。
 * - JPEG / WEBP 支持 0~1 的 quality 有损压缩参数。
 * - JPEG 不支持透明通道，画布默认是透明黑，这里转换前先铺白底，避免出黑边。
 *
 * @param {File} file
 * @param {{ format: 'png'|'jpeg'|'webp', quality?: number, maxDimension?: number }} opts
 * @returns {Promise<Blob>}
 */
export function convertImage(file, opts) {
    return new Promise((resolve, reject) => {
        const objectUrl = URL.createObjectURL(file);
        const img = new Image();

        img.onload = () => {
            let { naturalWidth: width, naturalHeight: height } = img;

            if (opts.maxDimension && Math.max(width, height) > opts.maxDimension) {
                const scale = opts.maxDimension / Math.max(width, height);
                width = Math.max(1, Math.round(width * scale));
                height = Math.max(1, Math.round(height * scale));
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');

            if (opts.format === 'jpeg') {
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, width, height);
            }

            ctx.drawImage(img, 0, 0, width, height);
            URL.revokeObjectURL(objectUrl);

            const mime = MIME_MAP[opts.format];
            const quality = opts.format === 'png' ? undefined : opts.quality;

            canvas.toBlob((blob) => {
                if (!blob) {
                    reject(new Error('画布导出失败（toBlob 返回空）'));
                    return;
                }
                resolve(blob);
            }, mime, quality);
        };

        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error(`图片加载失败：${file.name}`));
        };

        img.src = objectUrl;
    });
}

/**
 * 根据目标格式返回该格式默认/建议的转换参数
 * @param {'png'|'jpeg'|'webp'} format
 */
export function defaultParamsForFormat(format) {
    if (format === 'png') {
        return { maxDimension: 2048 };
    }
    return { quality: 0.8 };
}

export function extensionForFormat(format) {
    return format === 'jpeg' ? 'jpg' : format;
}

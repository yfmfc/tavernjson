/**
 * SillyTavern 的 Chat Completion 预设 JSON 里：
 *  - prompts[]        是所有 prompt 定义的"无序仓库"（每次在 Prompt Manager 里增删/拖拽
 *                      只是对这个数组做 push/splice，顺序会越用越乱）
 *  - prompt_order[]    每一项对应一个 character_id（100000 = 默认角色上下文，
 *                      100001 = 群聊/中性上下文，其余数字为具体角色的 chid），
 *                      其中的 order[] 数组（{identifier, enabled}）才是真正决定
 *                      "发送顺序 + 是否启用"的东西。
 *
 * 整理逻辑：选定一个 character_id 的 order[] 作为参照顺序，把 prompts[] 数组本身
 * 按这个顺序重新排列；prompt_order、以及其他所有顶层字段完全不动。
 */

/**
 * @param {object} preset 已经 JSON.parse 过的预设对象
 * @param {number} [refCharacterId] 参照哪个 character_id 的顺序，默认优先 100000
 * @returns {{ preset: object, refCharacterId: number, appendedCount: number }}
 */
export function organizePreset(preset, refCharacterId) {
    if (!preset || !Array.isArray(preset.prompts) || !Array.isArray(preset.prompt_order)) {
        throw new Error('不是有效的 Chat Completion 预设文件（缺少 prompts 或 prompt_order 字段）');
    }

    let refEntry;
    if (refCharacterId !== undefined) {
        refEntry = preset.prompt_order.find((p) => p.character_id === refCharacterId);
    }
    if (!refEntry) {
        refEntry = preset.prompt_order.find((p) => p.character_id === 100000) ?? preset.prompt_order[0];
    }
    if (!refEntry || !Array.isArray(refEntry.order)) {
        throw new Error('prompt_order 中没有可用的参照顺序');
    }

    const orderIds = refEntry.order.map((o) => o.identifier);
    const promptMap = new Map(preset.prompts.map((p) => [p.identifier, p]));
    const sorted = [];

    for (const id of orderIds) {
        if (promptMap.has(id)) {
            sorted.push(promptMap.get(id));
            promptMap.delete(id);
        }
    }

    // 参照顺序里没提到、但确实存在于 prompts[] 里的项，原样追加在最后，绝不丢弃
    let appendedCount = 0;
    for (const p of preset.prompts) {
        if (promptMap.has(p.identifier)) {
            sorted.push(p);
            promptMap.delete(p.identifier);
            appendedCount++;
        }
    }

    // 只替换 prompts 这一个字段，其余原样保留（浅拷贝即可，因为其它字段不会被修改）
    const result = { ...preset, prompts: sorted };

    return { preset: result, refCharacterId: refEntry.character_id, appendedCount };
}

/**
 * 生成一段供 UI 展示的摘要信息
 */
export function summarizePreset(preset) {
    const orders = preset.prompt_order.map((p) => `character_id=${p.character_id}（${p.order.length} 项）`);
    return `共 ${preset.prompts.length} 个 prompt；prompt_order 中包含：\n${orders.join('\n')}`;
}

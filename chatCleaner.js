import { parseChatTimestamp } from './utils.js';

const MODULE_TAG = '[NicheToolbox:ChatCleaner]';

/**
 * 扫描所有角色（可选包含群组）的聊天文件，找出超过阈值天数未使用的聊天。
 * 使用的 API：
 *  - context.characters / context.groups（getContext 提供）
 *  - POST /api/characters/chats  { avatar_url }  -> 该角色下所有聊天的轻量元数据（含 last_mes）
 *  - POST /api/chats/group/get   { id }          -> 群组聊天的完整消息数组（没有轻量元数据接口，
 *                                                    只能取最后一条消息的时间戳）
 *
 * @param {{ thresholdDays: number, includeGroups: boolean }} options
 * @returns {Promise<Array<object>>}
 */
export async function scanIdleChats({ thresholdDays, includeGroups }) {
    const context = SillyTavern.getContext();
    const headers = context.getRequestHeaders();
    const now = Date.now();
    const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;
    const results = [];

    // 当前正在打开的聊天，扫描结果里要排除，避免删除正在使用的文件
    const currentCharAvatar = context.characterId !== undefined
        ? context.characters?.[context.characterId]?.avatar
        : undefined;
    const currentChatFile = context.getCurrentChatId?.();
    const currentGroupId = context.groupId;

    // ---- 1. 单人角色聊天 ----
    for (const character of context.characters ?? []) {
        if (!character?.avatar || character.avatar === 'none') continue;

        let chats;
        try {
            const resp = await fetch('/api/characters/chats', {
                method: 'POST',
                headers,
                body: JSON.stringify({ avatar_url: character.avatar }),
            });
            if (!resp.ok) {
                console.warn(MODULE_TAG, `获取 ${character.name} 的聊天列表失败`, resp.status);
                continue;
            }
            chats = await resp.json();
        } catch (err) {
            console.error(MODULE_TAG, `请求 ${character.name} 的聊天列表出错`, err);
            continue;
        }

        if (!Array.isArray(chats)) continue;

        for (const chat of chats) {
            const fileName = chat.file_name?.replace(/\.jsonl$/i, '');
            if (!fileName) continue;

            const lastMesTs = parseChatTimestamp(chat.last_mes ?? chat.last_mes_date ?? chat.date_last_chat);
            if (lastMesTs === null) {
                console.warn(MODULE_TAG, `无法解析时间字段，跳过`, character.name, fileName, chat);
                continue;
            }

            if (now - lastMesTs <= thresholdMs) continue;

            const isCurrentlyOpen = character.avatar === currentCharAvatar && fileName === currentChatFile;

            results.push({
                type: 'character',
                avatar: character.avatar,
                name: character.name,
                fileName,
                lastMesTs,
                mesCount: chat.chat_items ?? chat.mes ?? null,
                isCurrentlyOpen,
            });
        }
    }

    // ---- 2. 群组聊天 ----
    if (includeGroups) {
        for (const group of context.groups ?? []) {
            for (const chatId of group.chats ?? []) {
                let messages;
                try {
                    const resp = await fetch('/api/chats/group/get', {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({ id: chatId }),
                    });
                    if (!resp.ok) {
                        console.warn(MODULE_TAG, `获取群组聊天 ${chatId} 失败`, resp.status);
                        continue;
                    }
                    messages = await resp.json();
                } catch (err) {
                    console.error(MODULE_TAG, `请求群组聊天 ${chatId} 出错`, err);
                    continue;
                }

                if (!Array.isArray(messages) || messages.length === 0) continue;

                const last = messages[messages.length - 1];
                const lastMesTs = parseChatTimestamp(last?.send_date);
                if (lastMesTs === null) continue;
                if (now - lastMesTs <= thresholdMs) continue;

                const isCurrentlyOpen = group.id === currentGroupId && chatId === group.chat_id;

                results.push({
                    type: 'group',
                    groupId: group.id,
                    name: group.name,
                    fileName: chatId,
                    lastMesTs,
                    mesCount: messages.length,
                    isCurrentlyOpen,
                });
            }
        }
    }

    results.sort((a, b) => a.lastMesTs - b.lastMesTs);
    return results;
}

/**
 * 真实删除一个聊天文件。
 * 注意：角色聊天与群组聊天走不同的接口。字段名是根据官方文档 /api/chats/get
 * 的请求体格式（avatar_url + file_name）推断的，如果你的 SillyTavern /
 * TauriTavern 版本字段不同，删除会失败并在控制台打印出实际的 HTTP 状态，
 * 请对照你本地版本的 src/endpoints/chats.js 调整。
 *
 * @param {object} item scanIdleChats() 返回结果中的一项
 * @returns {Promise<{ok: boolean, status?: number}>}
 */
export async function deleteChatItem(item) {
    const context = SillyTavern.getContext();
    const headers = context.getRequestHeaders();

    try {
        if (item.type === 'character') {
            const resp = await fetch('/api/chats/delete', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    avatar_url: item.avatar,
                    file_name: item.fileName,
                }),
            });
            return { ok: resp.ok, status: resp.status };
        } else {
            const resp = await fetch('/api/chats/group/delete', {
                method: 'POST',
                headers,
                body: JSON.stringify({ id: item.fileName }),
            });
            return { ok: resp.ok, status: resp.status };
        }
    } catch (err) {
        console.error(MODULE_TAG, '删除聊天时出错', item, err);
        return { ok: false };
    }
}

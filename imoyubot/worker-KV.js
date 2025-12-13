/**
 * 🎨 验证码配置数据 (逻辑验证素材)
 * 格式：[文字, Emoji]
 */
const CAPTCHA_DATA = [
  ['苹果', '🍎'], ['香蕉', '🍌'], ['葡萄', '🍇'], ['西瓜', '🍉'], ['柠檬', '🍋'],
  ['汽车', '🚗'], ['飞机', '✈️'], ['火箭', '🚀'], ['自行车', '🚲'], ['警车', '🚓'],
  ['狗', '🐶'], ['猫', '🐱'], ['老虎', '🐯'], ['猪', '🐷'], ['猴子', '🐵'],
  ['足球', '⚽️'], ['篮球', '🏀'], ['地球', '🌍'], ['月亮', '🌙'], ['太阳', '☀️'],
  ['眼睛', '👁️'], ['耳朵', '👂'], ['手', '✋'], ['爱心', '❤️'], ['炸弹', '💣']
];

/**
 * 生成逻辑验证题
 */
function generateLogicProblem() {
  const targetIndex = Math.floor(Math.random() * CAPTCHA_DATA.length);
  const targetPair = CAPTCHA_DATA[targetIndex];
  
  const questionText = targetPair[0];
  const correctAnswer = targetPair[1];

  const otherPairs = CAPTCHA_DATA.filter((_, index) => index !== targetIndex);
  const shuffledOthers = otherPairs.sort(() => Math.random() - 0.5);
  const wrongOptions = shuffledOthers.slice(0, 5).map(pair => pair[1]);

  const allOptions = [correctAnswer, ...wrongOptions];
  const finalOptions = allOptions.sort(() => Math.random() - 0.5);

  return {
    question: `请点击下方的【${questionText}】`,
    answer: correctAnswer,
    options: finalOptions
  };
}

/**
 * 常量配置和环境变量初始化
 */
let TOKEN, WEBHOOK, SECRET, ADMIN_UID, lan;

// ⬇️⬇️⬇️ 数据库配置 ⬇️⬇️⬇️
const fraudDb = 'https://raw.githubusercontent.com/moyu-hax/test/refs/heads/main/imoyubot/fraud.db';
const blocklistUrl = 'https://raw.githubusercontent.com/moyu-hax/test/refs/heads/main/imoyubot/blocklist.txt';

const MAX_VERIFY_ATTEMPTS = 5;  // 🔢 最多尝试5次
const VERIFICATION_TTL = 300;  // ⏱️ 验证码过期时间：5分钟
const VERIFIED_TTL = 259200;  // ⏱️ 验证成功有效期：3天

// 屏蔽词缓存相关常量
const REMOTE_CACHE_KEY = 'blocked-words-cache';
const REMOTE_ETAG_KEY = 'blocked-words-etag';
const REMOTE_LASTFETCH_KEY = 'blocked-words-lastfetch';
const BLOCKLIST_REFRESH_MS = 15 * 60 * 1000; // 缓存 15 分钟

/**
 * 处理请求的主入口（用于 Service Worker）
 */
function initConfig(env) {
  TOKEN = env.BOT_TOKEN;
  SECRET = env.BOT_SECRET;
  ADMIN_UID = env.ADMIN_UID;
  WEBHOOK = '/endpoint';
  lan = env.lan;
  
  if (!TOKEN || !SECRET || !ADMIN_UID) {
    throw new Error('❌ 环境变量未配置: BOT_TOKEN, BOT_SECRET, ADMIN_UID');
  }
}

/**
 * 构建 Telegram API URL
 */
function apiUrl(methodName, params = null) {
  let query = '';
  if (params) {
    query = '?' + new URLSearchParams(params).toString();
  }
  return `https://api.telegram.org/bot${TOKEN}/${methodName}${query}`;
}

/**
 * 发送 Telegram 请求
 */
function requestTelegram(methodName, body, params = null) {
  return fetch(apiUrl(methodName, params), body).then(r => r.json());
}

/**
 * 构建请求体
 */
function makeReqBody(body) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  };
}

/**
 * 发送消息
 */
function sendMessage(msg = {}) {
  return requestTelegram('sendMessage', makeReqBody(msg));
}

/**
 * 复制消息
 */
function copyMessage(msg = {}) {
  return requestTelegram('copyMessage', makeReqBody(msg));
}

/**
 * 转发消息
 */
function forwardMessage(msg) {
  return requestTelegram('forwardMessage', makeReqBody(msg));
}

/**
 * 设置管理员菜单命令
 * ✅ 已更新菜单描述，提示支持 [UID]
 */
async function setAdminCommands() {
  const commands = [
    { command: 'block', description: '屏蔽用户 [UID] 或回复' },
    { command: 'unblock', description: '解除屏蔽 [UID] 或回复' },
    { command: 'checkblock', description: '检查屏蔽 [UID] 或回复' },
    { command: 'addwhite', description: '添加白名单 [UID]' },
    { command: 'removewhite', description: '移除白名单 [UID]' },
    { command: 'checkwhite', description: '检查白名单 [UID]' },
    { command: 'listwhite', description: '列出所有白名单' },
    { command: 'reloadblock', description: '刷新屏蔽词库' }
  ];

  return requestTelegram('setMyCommands', makeReqBody({
    commands: commands,
    scope: { type: 'chat', chat_id: ADMIN_UID }
  }));
}

/**
 * Webhook 监听 (Cloudflare Workers)
 */
export default {
  async fetch(request, env, ctx) {
    initConfig(env);
    
    const url = new URL(request.url);
    
    if (url.pathname === WEBHOOK) {
      return handleWebhook(request);
    } else if (url.pathname === '/registerWebhook') {
      return registerWebhook(request, url, WEBHOOK, SECRET);
    } else if (url.pathname === '/unRegisterWebhook') {
      return unRegisterWebhook(request);
    } else if (url.pathname === '/updateCommands') {
      try {
        const res = await setAdminCommands();
        return new Response(JSON.stringify(res, null, 2), { headers: { 'content-type': 'application/json' } });
      } catch (err) {
        return new Response('Error: ' + err.message, { status: 500 });
      }
    } else {
      return new Response('No handler for this request', { status: 404 });
    }
  }
};

/**
 * 处理 Webhook
 */
async function handleWebhook(request) {
  if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== SECRET) {
    return new Response('Unauthorized', { status: 403 });
  }
  
  try {
    const update = await request.json();
    await onUpdate(update);
    return new Response('Ok');
  } catch (err) {
    console.error('❌ 处理 Webhook 错误:', err);
    return new Response('Error: ' + err.message, { status: 500 });
  }
}

/**
 * 检查用户是否在白名单中
 */
async function isWhitelisted(userId) {
  userId = userId.toString();
  const whitelisted = await lan.get('whitelist-' + userId);
  return whitelisted === 'true';
}

/**
 * 处理消息
 */
async function onMessage(message) {
  // /start 命令
  if (message.text === '/start') {
    return sendMessage({
      chat_id: message.chat.id,
      text: '👋 你好！\n我是 i墨雨 的 Telegram 私聊小助手，负责把你的消息安全转发给 i墨雨，并将 i墨雨 的回复再传递给你。\n\n⚠️ **注意：验证失败超过 5 次将会被自动屏蔽！**',
      parse_mode: 'Markdown'
    });
  }

  // 管理员命令
  if (message.chat.id.toString() === ADMIN_UID) {
    if (/^\/reloadblock$/.test(message.text)) return handleReloadBlocklist(message);
    
    // 白名单指令
    if (/^\/addwhite(?:\s+(\d+))?$/.test(message.text)) return handleAddWhitelist(message);
    if (/^\/removewhite(?:\s+(\d+))?$/.test(message.text)) return handleRemoveWhitelist(message);
    if (/^\/checkwhite(?:\s+(\d+))?$/.test(message.text)) return handleCheckWhitelist(message);
    if (/^\/listwhite$/.test(message.text)) return handleListWhitelist(message);

    // ✅ 屏蔽指令（支持正则参数）
    if (/^\/block(?:\s+(\d+))?$/.test(message.text)) return handleBlock(message);
    if (/^\/unblock(?:\s+(\d+))?$/.test(message.text)) return handleUnBlock(message);
    if (/^\/checkblock(?:\s+(\d+))?$/.test(message.text)) return checkBlock(message);

    if (!message?.reply_to_message?.chat) {
      return sendMessage({
        chat_id: ADMIN_UID,
        text: '请回复一条转发的消息进行操作，或使用菜单命令。'
      });
    }

    const guestChatId = await lan.get('msg-map-' + message?.reply_to_message.message_id);
    if (guestChatId) {
        return copyMessage({
          chat_id: guestChatId,
          from_chat_id: message.chat.id,
          message_id: message.message_id
        });
    }
  }

  return handleGuestMessage(message);
}

/**
 * 从消息或命令参数中提取目标 UID
 * (通用函数：既支持 /cmd 12345，也支持回复消息提取)
 */
async function getTargetUserId(message) {
  const match = message.text.match(/\/\w+\s+(\d+)/);
  if (match) return match[1];
  if (message.reply_to_message) {
    return await lan.get('msg-map-' + message.reply_to_message.message_id);
  }
  return null;
}

// ⬇️⬇️⬇️ 屏蔽词处理逻辑 ⬇️⬇️⬇️
function parseBlocklist(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return [];
  if ((trimmed.startsWith('[') && trimmed.endsWith(']')) ||
      (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
    try {
      const data = JSON.parse(trimmed);
      if (Array.isArray(data)) return data.map(s => String(s).trim()).filter(Boolean);
      if (data && Array.isArray(data.words)) return data.words.map(s => String(s).trim()).filter(Boolean);
    } catch {}
  }
  return trimmed.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
}

async function getRemoteCachedWords() {
  try {
    const txt = await lan.get(REMOTE_CACHE_KEY);
    if (!txt) return [];
    const obj = JSON.parse(txt);
    if (obj && Array.isArray(obj.words)) return obj.words;
  } catch {}
  return [];
}

async function fetchRemoteBlocklist({ force = false } = {}) {
  const lastFetchTxt = await lan.get(REMOTE_LASTFETCH_KEY);
  const lastFetch = lastFetchTxt ? parseInt(lastFetchTxt, 10) : 0;
  
  if (!force && lastFetch && (Date.now() - lastFetch) < BLOCKLIST_REFRESH_MS) {
    const words = await getRemoteCachedWords();
    return { words, updated: false, source: 'cache-fresh' };
  }

  const etag = await lan.get(REMOTE_ETAG_KEY);
  const headers = {};
  if (etag) headers['If-None-Match'] = etag;

  let res;
  try {
    res = await fetch(blocklistUrl, { headers });
  } catch (e) {
    const words = await getRemoteCachedWords();
    return { words, updated: false, source: 'cache-fallback' };
  }

  if (res.status === 304) {
    await lan.put(REMOTE_LASTFETCH_KEY, String(Date.now()));
    const words = await getRemoteCachedWords();
    return { words, updated: false, source: 'not-modified' };
  }

  if (!res.ok) {
    const words = await getRemoteCachedWords();
    return { words, updated: false, source: 'cache-on-error' };
  }

  const text = await res.text();
  const words = parseBlocklist(text);
  const payload = { words, updatedAt: Date.now() };
  await lan.put(REMOTE_CACHE_KEY, JSON.stringify(payload));
  await lan.put(REMOTE_LASTFETCH_KEY, String(payload.updatedAt));
  
  const newEtag = res.headers.get('ETag');
  if (newEtag) await lan.put(REMOTE_ETAG_KEY, newEtag);
  
  return { words, updated: true, source: 'remote' };
}

async function getBlockedWordsRemote() {
  const { words } = await fetchRemoteBlocklist();
  return words;
}

function hitBlockedKeyword(text, keywords) {
  if (!text) return null;
  const low = text.toLowerCase();
  for (const kw of keywords) {
    const k = String(kw || '').trim().toLowerCase();
    if (!k) continue;
    if (low.includes(k)) return kw;
  }
  return null;
}

function extractSearchableText(message) {
  const segs = [];
  if (typeof message.text === 'string') segs.push(message.text);
  if (typeof message.caption === 'string') segs.push(message.caption);
  return segs.join('\n').trim();
}

async function handleReloadBlocklist(message) {
  try {
    const { words, updated, source } = await fetchRemoteBlocklist({ force: true });
    return sendMessage({
      chat_id: ADMIN_UID,
      text: `✅ 屏蔽词库已刷新\n来源: ${source}\n状态: ${updated ? '已更新' : '未变更'}\n当前词条数: ${words.length}`
    });
  } catch (err) {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: `❌ 刷新失败: ${err.message}`
    });
  }
}
// ⬆️⬆️⬆️ 屏蔽词逻辑结束 ⬆️⬆️⬆️

async function handleAddWhitelist(message) {
  const guestChatId = await getTargetUserId(message);
  if (!guestChatId) return sendMessage({ chat_id: ADMIN_UID, text: '❌ 未找到目标用户' });

  await lan.put('whitelist-' + guestChatId, 'true');
  let whitelistData = (await lan.get('whitelist-data')) || '';
  const whitelistArray = whitelistData ? whitelistData.split(',').filter(v => v) : [];
  if (!whitelistArray.includes(guestChatId)) {
    whitelistArray.push(guestChatId);
    await lan.put('whitelist-data', whitelistArray.join(','));
  }
  return sendMessage({ chat_id: ADMIN_UID, text: `✅ UID: ${guestChatId} 已添加到白名单` });
}

async function handleRemoveWhitelist(message) {
  const guestChatId = await getTargetUserId(message);
  if (!guestChatId) return sendMessage({ chat_id: ADMIN_UID, text: '❌ 未找到目标用户' });

  await lan.delete('whitelist-' + guestChatId);
  let whitelistData = (await lan.get('whitelist-data')) || '';
  const whitelistArray = whitelistData.split(',').filter(v => v && v !== guestChatId);
  await lan.put('whitelist-data', whitelistArray.join(','));
  return sendMessage({ chat_id: ADMIN_UID, text: `✅ UID: ${guestChatId} 已从白名单移除` });
}

async function handleCheckWhitelist(message) {
  const guestChatId = await getTargetUserId(message);
  if (!guestChatId) return sendMessage({ chat_id: ADMIN_UID, text: '❌ 未找到目标用户' });
  const isWhite = await lan.get('whitelist-' + guestChatId);
  return sendMessage({ chat_id: ADMIN_UID, text: `UID: ${guestChatId} ${isWhite === 'true' ? '✅ 在白名单中' : '❌ 不在白名单中'}` });
}

async function handleListWhitelist(message) {
  const whitelistData = (await lan.get('whitelist-data')) || '';
  const whitelistArray = whitelistData ? whitelistData.split(',').filter(v => v) : [];
  if (whitelistArray.length === 0) return sendMessage({ chat_id: ADMIN_UID, text: '📋 白名单为空' });
  return sendMessage({ chat_id: ADMIN_UID, text: `📋 白名单用户列表 (共 ${whitelistArray.length} 个):\n${whitelistArray.join('\n')}` });
}

async function onCallbackQuery(callbackQuery) {
  try {
    const userId = callbackQuery.from.id.toString();
    const data = callbackQuery.data;
    const messageId = callbackQuery.message.message_id;

    if (!data.startsWith('verify_')) return;

    const [, userAnswer, correctAnswer] = data.split('_');

    if (userAnswer === correctAnswer) {
      await lan.put('verified-' + userId, 'true', { expirationTtl: VERIFIED_TTL });
      await lan.delete('verify-' + userId);
      await lan.delete('verify-attempts-' + userId);
      
      await requestTelegram('editMessageText', makeReqBody({
        chat_id: userId,
        message_id: messageId,
        text: '✅ 验证成功，你现在可以使用机器人了！',
        reply_markup: undefined
      }));
    } else {
      const attempts = parseInt(await lan.get('verify-attempts-' + userId) || '0') + 1;
      
      if (attempts >= MAX_VERIFY_ATTEMPTS) {
        await lan.delete('verify-' + userId);
        await lan.put('isblocked-' + userId, 'true');
        await requestTelegram('editMessageText', makeReqBody({
          chat_id: userId,
          message_id: messageId,
          text: '❌ 验证失败次数过多，已屏蔽',
          reply_markup: undefined
        }));
      } else {
        const { question, answer, options } = generateLogicProblem();
        
        await lan.put('verify-' + userId, answer, { expirationTtl: VERIFICATION_TTL });
        await lan.put('verify-attempts-' + userId, attempts.toString(), { expirationTtl: VERIFICATION_TTL });

        const keyboard = {
          inline_keyboard: [
            [
              { text: options[0], callback_data: `verify_${options[0]}_${answer}` },
              { text: options[1], callback_data: `verify_${options[1]}_${answer}` },
              { text: options[2], callback_data: `verify_${options[2]}_${answer}` }
            ],
            [
              { text: options[3], callback_data: `verify_${options[3]}_${answer}` },
              { text: options[4], callback_data: `verify_${options[4]}_${answer}` },
              { text: options[5], callback_data: `verify_${options[5]}_${answer}` }
            ]
          ]
        };

        await requestTelegram('editMessageText', makeReqBody({
          chat_id: userId,
          message_id: messageId,
          text: `❌ <b>验证失败</b> (${attempts}/${MAX_VERIFY_ATTEMPTS})\n题目已刷新，请重试：\n\n${question}`,
          parse_mode: 'HTML',
          reply_markup: keyboard
        }));

        await requestTelegram('answerCallbackQuery', makeReqBody({
          callback_query_id: callbackQuery.id,
          text: `❌ 选择错误，题目已刷新`,
          show_alert: false
        }));
      }
    }
  } catch (err) {
    console.error('处理回调查询错误:', err);
  }
}

async function onUpdate(update) {
  try {
    if ('message' in update) await onMessage(update.message);
    if ('callback_query' in update) await onCallbackQuery(update.callback_query);
  } catch (err) {
    console.error('处理更新错误:', err);
  }
}

async function handleGuestMessage(message) {
  try {
    const chatId = message.chat.id.toString();

    // 白名单直接转发
    const whitelisted = await isWhitelisted(chatId);
    if (whitelisted) {
      const forwardReq = await forwardMessage({
        chat_id: ADMIN_UID,
        from_chat_id: message.chat.id,
        message_id: message.message_id
      });
      if (forwardReq.ok) {
        await lan.put('msg-map-' + forwardReq.result.message_id, chatId);
        return handleNotify(message, chatId);
      }
      return;
    }

    // 屏蔽检查
    const isblocked = await lan.get('isblocked-' + chatId);
    if (isblocked === 'true') {
      return sendMessage({ chat_id: chatId, text: 'You are blocked' });
    }

    // 验证检查
    const verified = await lan.get('verified-' + chatId);
    if (!verified) {
      let attempts = await lan.get('verify-attempts-' + chatId);
      if (!attempts) attempts = '0';

      const { question, answer, options } = generateLogicProblem();
      
      await lan.put('verify-' + chatId, answer, { expirationTtl: VERIFICATION_TTL });
      await lan.put('verify-attempts-' + chatId, attempts, { expirationTtl: VERIFICATION_TTL });

      const keyboard = {
        inline_keyboard: [
          [
            { text: options[0], callback_data: `verify_${options[0]}_${answer}` },
            { text: options[1], callback_data: `verify_${options[1]}_${answer}` },
            { text: options[2], callback_data: `verify_${options[2]}_${answer}` }
          ],
          [
            { text: options[3], callback_data: `verify_${options[3]}_${answer}` },
            { text: options[4], callback_data: `verify_${options[4]}_${answer}` },
            { text: options[5], callback_data: `verify_${options[5]}_${answer}` }
          ]
        ]
      };
      
      return sendMessage({
        chat_id: chatId,
        text: `🔐 <b>人机验证</b>\n\n${question}`,
        parse_mode: 'HTML',
        reply_markup: keyboard
      });
    }

    // 诈骗库检查
    if (await isFraud(chatId)) {
      return sendMessage({ chat_id: ADMIN_UID, text: `⚠️ 检测到诈骗人员\nUID: ${chatId}` });
    }

    // 屏蔽词检查
    try {
      const messageText = extractSearchableText(message);
      const blockedWords = await getBlockedWordsRemote(); 
      const hit = hitBlockedKeyword(messageText, blockedWords);

      if (hit) {
        await sendMessage({
          chat_id: chatId,
          text: '⚠️ 您的消息包含被屏蔽的关键词，无法转发。'
        });
        const userName = message.from.first_name || '用户';
        await sendMessage({
          chat_id: ADMIN_UID,
          text: `🛡️ **关键词拦截**\n用户: ${userName} (UID: ${chatId})\n关键词: \`${hit}\`\n内容已被拦截，未转发。`,
          parse_mode: 'Markdown'
        });
        return; 
      }
    } catch (err) {
      console.error('关键词检测出错:', err);
      await sendMessage({ chat_id: ADMIN_UID, text: `⚠️ 关键词检测模块出错: ${err.message}` });
    }

    // 转发消息
    const forwardReq = await forwardMessage({
      chat_id: ADMIN_UID,
      from_chat_id: message.chat.id,
      message_id: message.message_id
    });

    if (forwardReq.ok) {
      await lan.put('msg-map-' + forwardReq.result.message_id, chatId);
      return handleNotify(message, chatId);
    }
  } catch (err) {
    console.error('处理客户消息错误:', err);
  }
}

async function handleNotify(message, chatId) {
  try {
    if (await isFraud(chatId)) {
      return sendMessage({ chat_id: ADMIN_UID, text: `检测到骗子，UID: ${chatId}` });
    }
  } catch (err) {
    console.error('处理通知错误:', err);
  }
}

// ✅ 修改后的 handleBlock，支持参数
async function handleBlock(message) {
  try {
    const guestChatId = await getTargetUserId(message);

    if (!guestChatId) {
      return sendMessage({
        chat_id: ADMIN_UID,
        text: '❌ 未找到目标。请回复消息或使用: /block <UID>'
      });
    }

    if (guestChatId === ADMIN_UID) {
      return sendMessage({
        chat_id: ADMIN_UID,
        text: '不能屏蔽自己'
      });
    }

    await lan.put('isblocked-' + guestChatId, 'true');
    return sendMessage({
      chat_id: ADMIN_UID,
      text: `UID: ${guestChatId} 屏蔽成功`
    });
  } catch (err) {
    console.error('处理屏蔽错误:', err);
  }
}

// ✅ 修改后的 handleUnBlock，支持参数
async function handleUnBlock(message) {
  try {
    const guestChatId = await getTargetUserId(message);

    if (!guestChatId) {
      return sendMessage({
        chat_id: ADMIN_UID,
        text: '❌ 未找到目标。请回复消息或使用: /unblock <UID>'
      });
    }

    await lan.delete('isblocked-' + guestChatId);
    return sendMessage({
      chat_id: ADMIN_UID,
      text: `UID: ${guestChatId} 解除屏蔽成功`
    });
  } catch (err) {
    console.error('处理解除屏蔽错误:', err);
  }
}

// ✅ 修改后的 checkBlock，支持参数
async function checkBlock(message) {
  try {
    const guestChatId = await getTargetUserId(message);

    if (!guestChatId) {
      return sendMessage({
        chat_id: ADMIN_UID,
        text: '❌ 未找到目标。请回复消息或使用: /checkblock <UID>'
      });
    }

    const blocked = await lan.get('isblocked-' + guestChatId);

    return sendMessage({
      chat_id: ADMIN_UID,
      text: `UID: ${guestChatId} ${blocked === 'true' ? '被屏蔽' : '没有被屏蔽'}`
    });
  } catch (err) {
    console.error('检查屏蔽状态错误:', err);
  }
}

async function isFraud(id) {
  try {
    id = id.toString();
    const db = await fetch(fraudDb).then(r => r.text());
    const arr = db.split('\n').filter(v => v.trim());
    return arr.some(v => v.trim() === id);
  } catch (err) {
    console.error('检查诈骗列表错误:', err);
    return false;
  }
}

async function registerWebhook(event, requestUrl, suffix, secret) {
  try {
    const webhookUrl = `${requestUrl.protocol}//${requestUrl.hostname}${suffix}`;
    const r = await fetch(apiUrl('setWebhook', { url: webhookUrl, secret_token: secret })).then(r => r.json());
    return new Response('ok' in r && r.ok ? 'Ok' : JSON.stringify(r, null, 2));
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }, null, 2), { status: 500 });
  }
}

async function unRegisterWebhook(event) {
  try {
    const r = await fetch(apiUrl('setWebhook', { url: '' })).then(r => r.json());
    return new Response('ok' in r && r.ok ? 'Ok' : JSON.stringify(r, null, 2));
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }, null, 2), { status: 500 });
  }
}

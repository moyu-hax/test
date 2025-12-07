
## 双向tg机器人使用

一个基于 Cloudflare Workers 的 Telegram 消息转发机器人。
> 💡 本项目参考 [telegram-verify-bot](https://github.com/Squarelan/telegram-verify-bot)，在其基础上增加了多重验证和管理功能。

---

## 🚀 快速开始

### 前置条件

- Cloudflare 账户
- Telegram 账户

### 部署步骤

#### 获取 Telegram 配置

- 从 [@BotFather](https://t.me/BotFather) 获取 Bot Token，并执行 `/setjoingroups` 禁止 Bot 被添加到群组
- 从 [@username_to_id_bot](https://t.me/username_to_id_bot) 获取你的用户 ID

#### 生成 Webhook 密钥

- 访问 [UUID 生成器](https://www.uuidgenerator.net/) 生成一个随机 UUID 作为 `SECRET`

#### 在 Cloudflare 创建 Worker

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 进入 Workers & Pages → Create application → Start with Hello World!
3. 给 Worker 命名（如 telegram-verify-bot）
4. 点击 Deploy

#### 配置环境变量

在 Worker 设置中，进入 Settings → Variables，添加以下环境变量：

| 变量名 | 说明 | 示例 |
|------|------|------|
| BOT_TOKEN | Telegram Bot Token | 123456:ABCDEFxyz... |
| BOT_SECRET | Webhook 密钥 | 550e8400-e29b-41d4-a716-446655440000 |
| ADMIN_UID | 你的 Telegram 用户 ID | 123456789 |

##### 📦 KV 版本（worker-KV.js）


**配置步骤：**

1. 进入 Workers KV
2. 创建新的 KV 命名空间：`lan`
3. 在 Worker 设置中，进入 Settings → Bindings → Add binding
   - Variable name： `lan`
   - KV namespace： 选择刚创建的 `lan`
4. 部署 [worker-KV.js](./worker-KV.js) 代码

#### 部署代码

1. 进入 Worker Edit code
2. 选择对应版本的代码：
   - KV 版本： 复制 [worker-KV.js](./worker-KV.js)
3. 点击 Deploy

#### 注册 Webhook

访问以下 URL 注册 webhook（替换 `xxx.workers.dev` 为你的 Worker 域名）：

https://xxx.workers.dev/registerWebhook


成功后将看到 `Ok` 响应。

### 机器人创建者（管理员）

#### 基础操作

**回复用户消息流程：**

1. 用户发送消息 → 机器人转发给你
2. 长按转发的消息
3. 选择"回复"
4. 输入消息内容
5. 消息自动回复给原用户

#### 管理命令

**屏蔽/解除屏蔽用户：**

| 命令 | 功能 | 使用方式 |
|-----|------|--------|
| `/block` | 屏蔽用户 | 回复用户消息后发送 |
| `/unblock` | 解除屏蔽 | 回复用户消息后发送，或 `/unblock [UID]` |
| `/checkblock` | 查看屏蔽列表 | 直接发送（私聊）或话题内发送 |

**白名单管理：**

| 命令 | 功能 | 使用方式 |
|-----|------|--------|
| `/addwhite [UID]` | 添加白名单 | 直接指定 UID 或回复消息 |
| `/removewhite [UID]` | 移除白名单 | 直接指定 UID 或回复消息 |
| `/checkwhite [UID]` | 检查白名单状态 | 直接指定 UID 或回复消息 |
| `/listwhite` | 列出所有白名单 | 直接发送 |

**白名单用户特殊权限：**

- ✅ 直接跳过数学验证
- ✅ 无需再次验证（永久有效）
- ✅ 屏蔽列表检查被跳过
- ✅ 消息直接转发

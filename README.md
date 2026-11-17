# ChatBloom

聊点日常，表达更自然。

ChatBloom 是一个适配手机和电脑的英语文字聊天网页。你可以自由聊日常，AI 用英语回应、轻度引导话题，并按需附上一条简短的中文表达建议。首版默认练习自然口语表达，面向自己和少量朋友试用。

建议分为两类：

- **需要改正（`correction`）**：原表达存在语法或用词等问题。
- **换种说法（`alternative`）**：原表达可以成立，提供一种适合当前语境的可选表达。

每轮最多一条建议；没有值得改进的地方时可以没有建议。目标是让对话继续，也让用户逐渐积累自己用得上的表达。

## 本地运行

需要 **Node.js 22 或更新版本**。项目使用标准 JavaScript 和 Node.js 内置能力，没有第三方运行依赖。

在项目根目录执行：

```bash
cp .env.example .env.local
```

编辑 `.env.local`：

```dotenv
DEEPSEEK_API_KEY=替换为你的DeepSeekAPIKey
DEEPSEEK_MODEL=deepseek-flash
```

然后启动：

```bash
npm run dev
```

开发服务监听 `0.0.0.0:3000`。本机打开 [http://localhost:3000](http://localhost:3000)。

`DEEPSEEK_API_KEY` 仅供服务端使用，不应放进前端代码或提交到 Git。`DEEPSEEK_MODEL` 默认是 `deepseek-flash`；服务端调用 DeepSeek 官方 API，并显式关闭 thinking，适合简短日常交流。

未配置 API Key 时，页面会进入**明确标记的示例模式**。示例模式可以体验界面和聊天流程，但不会调用真实模型，也不能用来验证模型的回复质量。配置真实 Key 后，需要另外进行真实接口验证。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动本地开发服务，监听 `0.0.0.0:3000` |
| `npm test` | 运行自动化测试 |
| `npm run build` | 构建单文件 Cloudflare Worker：`dist/server/index.js` |

## 源码说明

项目将网页界面、服务端逻辑和构建脚本保存在同一份源码中：

- `public/index.html`、`public/app.js`、`public/styles.css`：浏览器端页面、交互和样式。
- `src/api.mjs`：`handleApi` 处理 `/api/status` 与 `/api/chat`，包括模型状态和聊天请求。
- `src/worker.mjs`：Cloudflare Worker 入口。
- `scripts/dev.mjs`：本地开发服务；`scripts/build.mjs`：单文件 Worker 构建。
- `test/`：自动化测试。
- `docs/product.md`：首版产品范围、交互规则和后续方向。

目标 GitHub 仓库是 [xuhuilun/ChatBloom](https://github.com/xuhuilun/ChatBloom)。本地文件和部署预览不代表已经推送到该仓库。

## 数据与隐私

完整聊天记录仅保存在**当前浏览器的本地存储**中，应用不把完整历史保存到服务端数据库。为了让模型接上话题，每次真实模型请求会把当前输入和经过裁剪的最近对话上下文发送给 DeepSeek；因此，本地保存不等于对话不会离开设备。DeepSeek 对收到的数据如何处理，以其服务条款和隐私政策为准。

本地记录最多保留最近 **12 段对话**，每段最多 **120 条消息**；超出上限时会轮换移除旧记录。浏览器存储不会自动跨设备同步，也不是永久备份。清理网站数据、切换浏览器或使用无痕模式，都可能导致历史记录不可用。共享设备上的其他使用者也可能访问同一浏览器保存的聊天。

## 构建与部署

执行 `npm run build` 后，`dist/server/index.js` 是包含网页和 API 处理逻辑的标准 Cloudflare Worker，可迁移到支持该运行方式的部署环境。生产环境需要在服务端配置 `DEEPSEEK_API_KEY`，可选配置 `DEEPSEEK_MODEL`；本地 `.env.local` 不会自动变成生产环境配置。

**仅把 `public/` 上传到静态托管不能运行聊天 API。** 真实聊天需要部署服务端 Worker，并正确配置密钥。

首版预览计划通过 Sites 以仅所有者可访问的方式部署。若需要邀请朋友，必须另行配置可访问范围；拥有预览链接不代表已经开放访问。

## 已知限制

- 首版以日常英语文字聊天和口语表达建议为主，尚不提供语音练习或专门的书面表达模式。
- 表达建议由模型生成，可能误判语境或改变语气；`alternative` 是一种选择，并非唯一正确答案。
- 本地历史不跨设备，也不承诺永久保存。
- 首版通过仅所有者可访问的预览控制试用范围，尚未实现应用内额度管理或限流。
- 若以后公开部署，需要配置服务端访问控制、调用额度与滥用防护，避免 API Key 对应的费用失控。

更完整的产品约定见 [产品说明](docs/product.md)。

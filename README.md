# Claude Account Reset

在 macOS 上检查、清理已知的 Claude 账号状态，并校验本地会话文件未变。独立社区工具，与 Anthropic 无隶属关系。

- 网页与下载：https://claude-account-reset.pages.dev
- 源码：https://github.com/ForceMind/claude-account-reset
- 当前版本：0.1.0。规则来自 Claude Desktop 4.29.0 的本地检查与 MultiClaude 源码；其他版本和配置可能不同。

## 使用

需要 macOS 和 Node.js 22+。先退出 Claude Desktop、Claude Code。不要使用 sudo。

下载网页提供的 `install.sh`，阅读后在终端运行 `bash install.sh`。它在当前目录下新建版本目录、下载并校验工具、安装锁定依赖，只打印下一步命令，不执行清理。安装会访问 Cloudflare Pages 和 npm；后续本地检查/清理代码不发送网络请求。

也可以从源码运行：

```sh
git clone https://github.com/ForceMind/claude-account-reset.git
cd claude-account-reset
npm ci --ignore-scripts --no-audit --no-fund
node bin/reset.mjs --traces
```

默认是只读检查。检查 Local Storage 时使用权限为 0700 的临时副本，结束后删除；不把密码、Cookie 值或令牌写到报告中。报告包含路径与字段名，分享前仍需自行检查。

阅读检查结果后，选择执行范围：

```sh
# 重置已知登录状态，保留会话与一般设置
node bin/reset.mjs --apply --yes

# 额外清理已知账号功能缓存、遥测及退出标记
node bin/reset.mjs --apply --yes --traces

# 同时删除共享的应用加密密钥（单独选择，通常换账号不需要）
node bin/reset.mjs --apply --yes --traces --include-keychain
```

可以用 `--report cleanup.report.json` 保存本地报告（只允许新文件，权限 0600）。`--profile '/absolute/path/to/profile'` 可重复指定 Desktop 目录；未指定时发现 `~/Library/Application Support/Claude` 和相邻 `Claude-*` 目录。`Claude-3p` 也检查，但不假定它由多账号工具创建。

## 清理契约

| 内容 | 默认重置 | `--traces` |
| --- | --- | --- |
| 已知 OAuth 字段、账号提示、同步归属、登录方式 | 删除/清空 | 同左 |
| 主 Cookie 数据库及日志 | 删除 | 同左 |
| `config.json.journal` | 删除，防止配置恢复旧状态 | 同左 |
| `remote-control-state.json` 的 identities | 清空，其他字段保留 | 同左 |
| 默认 Claude Code `.credentials.json` | 如存在则删除 | 同左 |
| 默认 Claude Code 配置及其配置备份的已知账号字段 | 只移除字段，项目配置保留 | 同左，额外移除已知功能缓存 |
| 遥测 ID/队列、退出标记、已知账号功能缓存 | 保留 | 删除 |
| 套餐用量文件、账号设备映射 | 保留 | 删除/清空 |
| `Claude Safe Storage / Claude Key` 钥匙串项 | 仅检查存在性 | 仍不删除，需 `--include-keychain` |

Local Storage 仅匹配 `https://claude.ai` 和 `app://localhost` 两种来源与明确的键名；其他来源、未知键、会话索引、草稿、会话结果和预设均保留。工具压缩 LevelDB 以移除失效记录，不代表 SSD、APFS 快照或备份中的数据被安全擦除。

钥匙串项是 Chromium Cookie 等数据使用的**共享加密密钥**，不是账号密码。删除后其他 profile 的已加密凭据也可能失效。工具不解密该密钥或 Cookie，不撤销服务器端 token，不清除 Safari/Chrome 登录，不修改系统环境变量和 API key 配置。

## 会话保护与限制

- 前后 SHA-256 校验：Desktop 的 `claude-code-sessions`、`local-agent-mode-sessions`、`side-session-notes`、`scratch-workspaces`、`git-shadow`、`IndexedDB`、`Session Storage`，以及默认 `~/.claude` 下的 `projects`、`sessions`、`file-history`、`uploads`。
- Local Storage 中保留的每条记录验证字节内容一致。JSON 配置只删允许清单字段，保留其他字段并回读。
- 检查与清理均要求退出 Claude。拒绝符号链接、无法解析的配置或数据库；运行中途失败会停止。多个文件之间不具备全局事务性，之前已完成的删除不会自动回滚。**不会备份令牌并偷偷恢复旧登录。**
- IndexedDB / Session Storage 保留但不解析，未知账号字段、日志、会话内的账号引用也可能保留。报告成功只表示本规则覆盖的清理和保护校验通过，**不能证明全机无账号痕迹或所有登录方式均已失效**。
- 自定义 `CLAUDE_CONFIG_DIR`、第三方 API key、企业 SSO、任意路径 profile 需要人工确认；默认 Claude Code 配置之外的凭据不会自动清理。
- 保留本地文件不等于把会话迁移到新账号。新账号是否显示旧历史受 Claude 自身账号策略影响。
- 这不是备份或恢复工具。可先用自己的可靠备份方案保存重要会话。没有保证所有版本可用，也没有在你的新账号上自动登录验收。

## 开发与部署

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run build:site
# 使用已登录的 Wrangler 4，在 Cloudflare Pages 上直接部署 site/
wrangler pages deploy site --project-name claude-account-reset --branch main
```

合成数据测试覆盖只读检查、精确删除、会话/草稿保护、配置备份、重复执行、异常 JSON 与符号链接；不触碰开发者真实账号。网页无第三方脚本、统计或上传表单。浏览器未验证。

经验与原理见 [docs/LESSONS.md](docs/LESSONS.md)。MIT License。

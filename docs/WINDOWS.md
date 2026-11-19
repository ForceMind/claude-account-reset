# Windows x64 预览版

在桌面应用的「检查与清理」中，可查看 Windows 资料布局并预览所选目录的登录清理。高级归档和活动目录隔离使用源码工具包中的 Windows CLI。先完全退出 Claude Desktop、系统托盘中的 Claude 及 Claude Code，再生成计划和执行。

| 目标 | 入口 | 验收 |
| --- | --- | --- |
| 清除已知登录状态 | 图形客户端或 `bin/reset.mjs` | 所选配置和 Cookie 的预期变化通过回读，受保护的会话文件未改动。实际身份在客户端单独确认。 |
| 保存可读的脱敏历史 | `bin/windows.mjs archive-plan` | 回读文件清单、SHA-256 和权限。逐项确认可见正文、工具记录、附件与文件历史。 |
| 为首次启动腾出活动路径 | `bin/windows.mjs fresh-plan` | 所选路径离开活动位置，隔离原件与归档回读通过，MSIX 注册状态单列。首启界面和身份由用户在退出工具后检查。 |

## 核对实际布局

```powershell
node bin/windows.mjs audit
```

命令核对用户目录、系统已知文件夹、用户注册表和传入的环境路径。遇到重定向、链接或权限导致根无法核实，写入停止。检查识别到的 `Claude-Data`、MSIX 数据槽、常见 `Claude` / `Claude-3p`、默认 Code 根和 `CLAUDE_CONFIG_DIR` 覆盖。报告列出路径及已知资料项，凭据管理器只记录产品名称可能匹配的状态，环境变量只列名称。未知名称、由外部 helper 提供的凭据、密文和浏览器状态需要另查。

当前登录清理覆盖显式选择的 Code 配置和已识别的 MSIX Roaming Claude 资料。处理已知配置字段、Code 凭据文件及 `claude.ai` / `.claude.ai` 上识别到的 `sessionKey`、`sessionKeyV2`、`activitySessionId`。数据库有活动事务文件或格式不明时跳过对应 Cookie，并在预览中提示。Local Storage、Session Storage、IndexedDB、设备登记、扩展授权和系统凭据在此模式保留。

```powershell
# 从工具包目录运行。参数使用已核实的本机路径，计划放到仓库外。
node bin/reset.mjs --code-dir "$env:USERPROFILE\.claude" --backup-dir "$env:USERPROFILE\Claude-private-backups" --plan-out "$env:USERPROFILE\login.plan.json"
node bin/reset.mjs --execute "$env:USERPROFILE\login.plan.json" --yes
```

可单独使用 `--profile` 选择已识别的 MSIX Roaming 路径。CLI 备份可通过 `bin/backup.mjs` 检查和恢复。备份可能含旧凭据。恢复碰到新文件、内容或权限冲突时停止。

## 归档可读历史

从 v0.8.0 Windows 工具包目录使用 Node.js 22.13+。先运行 `node bin/windows.mjs history "ACTIVITY_PATH"`，核对已识别的历史路径，补充人工检查外部附件和未公开格式。把拟保留文件和已知旧账号、组织 UUID 写入仓库外的私有 JSON。下面是合成示例。

```json
{
  "ids": ["12345678-0000-4000-8000-123456789abc"],
  "files": [
    {"path": "C:/Users/Example/.claude/projects/demo/session.jsonl", "format": "transcript"},
    {"path": "C:/Users/Example/.claude/file-history/demo/edit.txt", "format": "text"},
    {"path": "C:/Users/Example/.claude/attachments/demo/capture.png", "format": "binary"}
  ]
}
```

```powershell
node bin/windows.mjs archive-plan "C:/Users/Example/Private/archive-spec.json"
# 审阅输出的源文件、归档相对路径、格式和哈希后，执行计划。
node bin/windows.mjs apply PLAN_ID --yes
node bin/windows.mjs verify PLAN_ID
```

- `transcript` 适用于 UTF-8 JSONL。保留可见记录和工具记录，剥离已识别的 thinking 块，并生成便于阅读的 Markdown。未知 thinking 结构会停止。
- `json` 检查 JSON 键和值，`text` 检查 UTF-8 明文。路径和上述内容里的所列 UUID 使用一致的占位符。文本单文件上限 32 MiB，配置和凭据文件不属于归档选择范围。
- `binary` 保留原字节。哈希验证完整性，图片、压缩内容、密文和未知编码中的身份信息仍需人工检查。脱敏范围限于提供的 UUID 和支持的格式。对原始正文或附件含其他私密资料的情况，分享前需逐项核对。

归档写入 `%USERPROFILE%\.claude-account-reset\archive-<ID>`，在本机回读清单、内容、权限。用归档中的 Markdown 和选好的附件在新账号开启新对话。旧组织签名、索引及账号配置无需回灌。可读、侧栏可见和原生续接是三个不同的结果。

## 隔离活动目录并验收首次启动

在私有 JSON 中填写 audit 已验证且标记为 `canMove: true` 的绝对路径及已校验的归档 ID。按需要列出各个路径，例如同批选入默认的 `.claude` 和用户根 `.claude.json`。保留的其他 profile 或环境覆盖可能改变下一次启动结果。

```json
{
  "paths": ["C:/Users/Example/.claude", "C:/Users/Example/.claude.json"],
  "archiveId": "23456789-0000-4000-8000-23456789abcd"
}
```

```powershell
node bin/windows.mjs fresh-plan "C:/Users/Example/Private/fresh-spec.json"
# 审阅活动路径、文件项数、归档和隔离目的地后再执行。
node bin/windows.mjs apply PLAN_ID --yes
# 必要时完全退出 Claude，回滚活动路径。
node bin/windows.mjs rollback PLAN_ID --yes
```

计划和执行都核对原件指纹与归档完整性。已识别的历史文件缺失或变更会阻止隔离。工具只把显式列出的路径移入同卷隔离区，回读原位置、隔离后的字节与 MSIX 注册。移动失败时尝试恢复已移动条目。遇到新启动写入的数据时停止覆盖并保留隔离原件。批次的 `journal.json` 记录每个原位置和校验依据。如果进程异常退出，先确认工作流已停止，再检查私有目录的 `workflow.lock` 中的进程号。确定是残留锁后可移除该锁文件，再按批次 ID 回滚。

AppX 包根、重解析点、MSIX 的共享缓存父目录、第三方 profile、外部 Code 根、项目文件及浏览器不属于默认清理目标。Windows CLI 返回的物理隔离结果不代替 Windows 自己的包重置。按 [重置检查清单](RESET-CHECKLIST.md) 的同一范围分别核对 Windows 包注册、活动数据和新启动身份。若另行采用系统重置命令，要独立记录退出状态、AppX 事件、包注册和实际目录。退出码非零时先回读状态。

隔离原件、私有计划与回滚记录可能保留旧 ID 和登录材料。工具没有自动销毁入口。仅在归档正文、附件和文件历史清单及 SHA-256、重置后的实际状态、保留档案回读均通过，且已单独授权时，才应处置含旧标识的临时原件。

## 构建与核验

在 Windows x64 运行 `npm ci --ignore-scripts --no-audit --no-fund`、`npm run test:windows` 和 `npm run desktop:make:windows`。CI 用合成资料检查清理、归档、部分失败、恢复与包内后台。Windows 安装包为预览分发，下载后用 `Get-FileHash -Algorithm SHA256` 核对 GitHub Release 校验文件。实际账号和首次启动身份需单独验收。

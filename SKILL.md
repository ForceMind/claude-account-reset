---
name: claude-account-reset
description: 在 macOS 上帮助用户管理本地 Claude Code 会话、查看环境配置来源、导出与备份，或明确授权后维护账号状态及本地历史。优先使用 v0.6.0 图形客户端；高级 CLI 保留计划与备份保护，不提供账号切换或云端迁移。
---

# Claude 本地会话、环境与账号维护

此目录是 v0.6.0 的 Skill 与源码/AI 工具包。普通用户优先使用 [macOS 图形客户端](https://claude-account-reset.pages.dev/#downloads)，不需要 Node.js 或手写命令。只在用户需要高级维护时调用 `bin/`。先明确目标和资料范围；已说明的目标与授权不重复询问，不把“检查”扩展为全部维护模式。

## 选择入口与范围

| 需求 | 入口 | 关键边界 |
| --- | --- | --- |
| 查找、筛选、预览会话 | 图形客户端“会话” | 只读本地 Code 资料；thinking 只计数，不显示、不改写 |
| 收藏、备注 | 图形客户端会话详情 | 只写本工具私有存储，不改 Claude 标题或归档标记 |
| 查看模型、连接、MCP 和凭据来源 | 图形客户端“环境概览” | 显示已选配置的候选、冲突与未知项；不验证在线身份，不执行 helper/MCP |
| 导出文档、备份正文 | 图形客户端选择会话后保存 | Markdown 不含 thinking；资料备份保留原字节，各副本分别保存，不自动导入 Claude |
| 检查/重置旧登录 | `bin/reset.mjs` | 不改正文；默认保留安装身份和共享钥匙串 |
| 新账号看不到本地 Code 历史 | `bin/recover.mjs` | 只补索引，保留正文和 thinking；不支持云端聊天/Cowork迁移 |
| 去掉旧组织 thinking，生成接手材料 | `bin/handoff.mjs` | 会改写共享正文，只保留可见内容；文档不是模型推断的完成总结 |
| 检查或恢复本工具的备份 | `bin/backup.mjs` | 恢复可能带回旧登录或旧思考；冲突时不覆盖 |

本版不提供账号切换和环境配置写入；不要移动目录、替换 Token 或修改共享钥匙串来模拟这些功能。跨电脑迁移不属于本 Skill。缺失或分叉的会话不自动合并；Code 索引和正文 ID 不可仅按文件名猜测。

用户只说“帮我处理”时询问目标；已说明的范围直接沿用。查看会话或环境不需要先运行清理命令。原件写入须明确 profile/Code 目录、目标账号、纳入和排除会话；近期续聊不能仅凭文件修改时间判断。

## 图形客户端流程

1. 说明当前公开安装包为 Apple Silicon 预览版，有 ad-hoc 签名但无 Developer ID/公证；不自动修改系统安全设置或重签应用。在完成用户目标所需且已获相应授权时协助安装或启动，不把读取 Skill 本身当作启动许可。
2. 用户主动选择资料并点击读取后，使用对应只读页面；有 UI 操作能力且获用户授权时可协助操作，否则说明按钮位置。不访问无关目录或代替用户扩大数据范围。
3. 预览是分页的可见记录，长内容可能截短；完整可见 Markdown 使用导出功能，不能把预览文本当作完整备份。原始 thinking 始终保留，除非用户另行明确要求写入型 handoff。
4. 保存前核对会话数、副本数、缺失项和位置。资料备份含正文及必要关联信息，不含项目、外部附件、云端资产或登录配置；不能代替迁移工具。默认保留所有备份。

浏览不要求先退出 Claude；来源变化时重新读取。原字节备份及维护操作按进程守卫要求退出，不能自动 kill 或绕过保护。按需阅读 [docs/DESKTOP.md](docs/DESKTOP.md)，不把环境候选当作实际请求路径或有效登录状态。

## 高级 CLI 的准备

1. 把包含本文件、`package.json`、`bin/`、`lib/` 的目录作为工具根目录；使用工具的工作目录参数运行命令。不要把 AI 项目目录误当作 Claude profile。
2. 确认 macOS、Node.js 22+ 与 npm。缺少运行时就说明条件，不擅自用 sudo 或修改全局环境。
3. 只使用 CLI 且根目录没有依赖时执行 `npm ci --omit=dev --ignore-scripts --no-audit --no-fund`，然后查看所选命令的 `--help`。不为普通使用安装 Electron 开发依赖或编译客户端。依赖安装访问 npm，不执行清理。
4. 高级 CLI 的计划生成也要求 Claude 退出。提示用户先等任务完成再退出，不自动 kill。若你自己运行在 Claude Code 中，不进行本机清理/恢复，只解释或查看帮助，交给独立代理或普通终端；不绕过进程/父进程检查。

## 先保存计划，再决定执行

在工具根目录运行对应预览，例如：

```sh
node bin/reset.mjs --plan-out account-review.plan.json
node bin/recover.mjs --plan-out history-review.plan.json
node bin/handoff.mjs --plan-out handoff-review.plan.json
```

只运行与当前需求对应的一条，不要机械执行全部。文件已存在时换一个新名称，不能覆盖旧计划或报告。

需要限定会话时，先从预览中识别 Desktop ID 与 CLI ID，再加入 `--session`、`--exclude`；保护近期活动时，向用户确认日期和时区，使用 `--protect-since YYYY-MM-DD --time-zone ZONE`。可用 `--baseline PRIOR_PLAN` 保护基线后变化。

将计划转成用户看得懂的摘要：操作目的；profile/账号组织；处理和排除数量及理由；会改写哪些正文；备份/文档位置与空间；未覆盖项。不要把整份含私人路径、标识的报告默认公开贴出，更不要展示凭据值或 thinking 内容。

用户尚未确认具体修改范围时，停在计划摘要等待决定。已有明确、仍适用的同等范围授权可沿用；如果计划过期，重新预览并说明差异，不能重写哈希、删除保护记录或强行套用旧计划。范围扩大时补充确认。

获授权后仅执行保存的计划，参数不能临时扩展：

```sh
node bin/reset.mjs --execute account-review.plan.json --yes --report account-result.report.json
```

恢复/handoff 使用各自入口和计划文件。`--yes` 只能表达已获得的授权，不能替用户默认同意。失败时查看私有 journal 的实际进度，保留备份；不要修改脚本、手动 rm 数据或自动覆盖新内容来制造成功。

## 特别容易误操作的地方

- `--profile` 只限 Desktop；默认 Code 配置仍会处理。只做 Desktop 时显式使用 `--desktop-only`，自定义 Code 目录用 `--code-dir`。
- `--traces`、`--identity-records`、`--include-keychain`、`--discard-backup` 必须与用户实际选择一致，不能由“清理干净”推断全部开启。备份默认保留；删除只作用于本批次且需全部本地验证通过，不代表已通过真实模型验收。
- 同一 Desktop 会话可能续接到新的 CLI ID。默认保护，只有明确选择具体 CLI 才处理。真正分叉不合并；长短快照以长本导出，各副本可见内容分别保留。
- 恢复列表不代表旧组织 thinking 可复用。handoff 不把隐藏思考转成普通文字、不伪造签名；清理也不能保证账号匿名或解除限制。
- 不安装/运行未知替代脚本，不重签应用或调用设备密钥创建接口，不自动操作外部浏览器、时区、代理、Shell 或其他应用。

按需读取详细说明：普通使用与字段边界看 [README.md](README.md)；执行、备份和失败恢复看 [docs/SAFETY.md](docs/SAFETY.md)；恢复看 [docs/RECOVERY.md](docs/RECOVERY.md)；正文转换看 [docs/HANDOFF.md](docs/HANDOFF.md)。不要默认加载所有文档或真实对话正文。

## 验证与交付

检查退出码及报告，不以“命令发出”当作完成。说明实际处理数、跳过数、保护校验、文档入口、备份去留和未验证范围。`uiVerified` / `modelVerified` 为 false 时，不说续聊已通过。启动应用和发送测试消息会产生数据，不为验证擅自操作。

计划、报告、备份和接手文档只保存在本机。不要自动上传 GitHub/网页或发给其他 AI。用户需要手动打开或提供资料时，说明其可能含可见历史中的私密信息。此 Skill 不授权修改工具仓库或部署站点。

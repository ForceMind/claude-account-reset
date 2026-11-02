---
name: claude-account-reset
description: 在 macOS 上帮助用户检查和重置已知 Claude 账号状态、恢复本地 Code 会话，或清理旧 thinking 并生成接手文档。使用随包命令保存计划、验证备份后执行；不用于解除封禁、迁移云端聊天或绕过身份验证。
---

# Claude 本地账号与会话维护

此目录同时是 Skill 和完整工具包。用户不必手写命令；由你定位本目录并调用 `bin/` 下的工具。先判断用户需要哪个入口，不要把“换账号”“记录不见了”或“检查”自动扩展成所有模式。

## 选择入口与范围

| 需求 | 入口 | 关键边界 |
| --- | --- | --- |
| 检查/重置旧登录 | `bin/reset.mjs` | 不改正文；默认保留安装身份和共享钥匙串 |
| 新账号看不到本地 Code 历史 | `bin/recover.mjs` | 只补索引，保留正文和 thinking；不支持云端聊天/Cowork迁移 |
| 去掉旧组织 thinking，生成接手材料 | `bin/handoff.mjs` | 会改写共享正文，只保留可见内容；文档不是模型推断的完成总结 |
| 检查或恢复本工具的备份 | `bin/backup.mjs` | 恢复可能带回旧登录或旧思考；冲突时不覆盖 |

用户只说“帮我处理”时，询问目标；若已说明目标则不要重复问。未获修改授权时只生成计划。明确 profile/Code 目录、目标账号、纳入和排除会话；近期续聊不得仅凭文件名或文件修改时间判断。

## 准备工具，不先碰账号数据

1. 把包含本文件、`package.json`、`bin/`、`lib/` 的目录作为工具根目录；使用工具的工作目录参数运行命令。不要把 AI 项目目录误当作 Claude profile。
2. 确认 macOS、Node.js 22+ 与 npm。缺少运行时就说明条件，不擅自用 sudo 或修改全局环境。
3. 根目录没有可用依赖时执行 `npm ci --ignore-scripts --no-audit --no-fund`，然后查看所选命令的 `--help`。依赖安装访问 npm，但不会执行清理。
4. 计划生成也要求 Claude 退出。提示用户先等任务完成再退出，不自动 kill。若你自己运行在 Claude Code 中，只能解释或查看帮助，交给独立 Codex/其他代理或普通终端执行；不绕过进程/父进程检查。

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

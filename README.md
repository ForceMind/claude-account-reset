# Claude Account Reset

**在 Mac 上重置已知的 Claude 登录状态，并在换账号后重新关联本地 Code 对话。**

[![Verify](https://github.com/ForceMind/claude-account-reset/actions/workflows/test.yml/badge.svg)](https://github.com/ForceMind/claude-account-reset/actions/workflows/test.yml)
![Platform: macOS](https://img.shields.io/badge/platform-macOS-black)
![Node.js: 22+](https://img.shields.io/badge/Node.js-22%2B-43853d)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[网页与下载](https://claude-account-reset.pages.dev/) · [使用说明](#快速开始) · [恢复对话](#恢复本地-code-对话) · [清理范围](#清理范围) · [原理与经验](docs/LESSONS.md) · [问题反馈](https://github.com/ForceMind/claude-account-reset/issues)

Claude 的账号状态分散在配置、Cookie、Local Storage 和系统钥匙串中，会话数据也可能与这些状态共用目录。直接删除整个应用数据目录，会同时丢失本地历史和设置。

这个工具使用明确的字段与键名规则清理已知账号状态，保留会话目录和其他存储记录，并在操作前后验证。默认只生成检查结果；执行清理、扩展清理范围、删除共享钥匙串密钥，分别需要显式选项。

> **当前版本：0.2.0，早期版本。** 规则依据 Claude Desktop 4.29.0 的本地检查及 MultiClaude 源码整理，尚未覆盖所有版本、企业登录方式或自定义配置。成功报告表示本工具覆盖的检查通过，不表示全机账号痕迹已全部消失。
>
> 独立社区项目，与 Anthropic 无隶属关系。

## 目录

- [适用场景](#适用场景)
- [环境要求](#环境要求)
- [快速开始](#快速开始)
- [恢复本地 Code 对话](#恢复本地-code-对话)
- [命令参考](#命令参考)
- [清理范围](#清理范围)
- [会话保护与执行机制](#会话保护与执行机制)
- [报告与退出状态](#报告与退出状态)
- [隐私与数据处理](#隐私与数据处理)
- [常见问题](#常见问题)
- [开发与部署](#开发与部署)
- [参与贡献](#参与贡献)
- [许可证与参考](#许可证与参考)

## 适用场景

- 准备登录另一个 Claude 账号，希望保留本地会话文件。
- 想检查客户端是否仍保存旧账号提示、同步归属或已知认证缓存。
- 需要一份可审阅的清理计划，以及清理后的文件保护验证结果。

本工具提供两个独立入口：`bin/reset.mjs` 用于清理，`bin/recover.mjs` 用于本地 Code 索引恢复。它不提供多账号启动管理、云端聊天迁移、服务器端 token 撤销或取证级数据擦除。需要长期并行使用多个账号时，独立 profile 的管理属于另一类需求。

## 环境要求

| 项目 | 要求 |
| --- | --- |
| 操作系统 | macOS；命令行入口会拒绝其他系统 |
| 运行时 | Node.js 22+，附带 npm |
| 运行身份 | 当前登录用户；不要使用 `sudo` |
| 应用状态 | 检查和清理前均需退出 Claude Desktop、Claude Code，并在操作期间保持关闭 |
| 网络 | 安装时需要访问下载站和 npm；清理工具本身不发送网络请求 |
| Git | 仅从源码安装时需要 |

清理会删除登录材料，多个文件之间没有全局事务，也不会自动备份或恢复令牌。请先用自己的备份方案保存重要会话。

## 快速开始

### 1. 安装工具

**方式 A：下载脚本**

从[下载网页](https://claude-account-reset.pages.dev/)获取 `install.sh`，阅读脚本后，在它所在的目录执行：

```sh
bash install.sh
cd claude-account-reset-0.2.0
```

安装脚本会新建版本目录、下载并校验工具包、使用锁文件安装依赖。已有同名目录时停止，不覆盖。**安装不会检查或清理 Claude 数据**，只打印下一步命令。

也可以下载[工具压缩包](https://claude-account-reset.pages.dev/downloads/claude-account-reset-0.2.0.tar.gz)和 [SHA256SUMS](https://claude-account-reset.pages.dev/downloads/SHA256SUMS)，自行校验和解压。

**方式 B：从源码安装**

```sh
git clone https://github.com/ForceMind/claude-account-reset.git
cd claude-account-reset
npm ci --ignore-scripts --no-audit --no-fund
```

项目目前通过源码和网页下载包分发，未发布到 npm。

### 2. 先检查

退出 Claude Desktop 和 Claude Code 后运行：

```sh
node bin/reset.mjs --traces
```

这一步展示扩展清理范围内的计划，不修改原始 Claude 数据。Local Storage 在本机私有临时副本中读取，结束后删除副本。

**默认会发现并处理多个 Desktop 数据目录。** 请阅读报告中的路径，确认哪些目录属于你希望重置的账号。需要限制 Desktop 范围时，使用 [`--profile`](#指定-desktop-数据目录)。

### 3. 选择清理范围

先选择满足需求的范围，再执行对应命令。

```sh
# 重置已知登录状态
node bin/reset.mjs --apply --yes
```

```sh
# 同时清理已知账号功能缓存、遥测和退出标记
node bin/reset.mjs --apply --yes --traces
```

共享钥匙串密钥默认保留。只有明确需要删除时才加上：

```sh
node bin/reset.mjs --apply --yes --traces --include-keychain
```

`Claude Safe Storage / Claude Key` 是应用加密密钥，不是账号密码。删除它可能使**其他 Desktop profile** 的已加密凭据也失效，导致重新登录或授权。通常换账号无需删除这个密钥。

### 4. 查看结果并重新登录

检查报告中的模式、处理项目和 `historyUnchanged`。命令成功结束后，可打开 Claude 登录新账号。

保留本地会话文件不等于把旧账号的聊天迁移到新账号；是否显示旧历史由 Claude 自身的账号规则决定。

## 恢复本地 Code 对话

换账号后，如果侧边栏为空但旧 `.jsonl` 正文还在，可以为目标账号重新建立本地 Code 索引。此功能**不会重置登录**，也不会自动恢复 Cowork 或普通云端聊天。

### 预览与执行

1. 在 Claude Desktop 中登录希望使用的新账号，进入 Code 一次，再完全退出客户端。
2. 在工具目录运行预览，核对目标账号目录、计划数量、跳过原因和 thinking 检测结果。
3. 确认范围后执行；成功后重新打开 Claude，检查列表和正文。

```sh
# 只预览，不写入索引或备份
node bin/recover.mjs --report recovery-preview.report.json

# 备份目标索引，新增缺失的会话记录
node bin/recover.mjs --apply --yes --report recovery-result.report.json
```

| 恢复参数 | 说明 |
| --- | --- |
| `--source PATH` | 源 Desktop 目录，可重复传入；默认发现 `Claude` 和相邻 `Claude-*` |
| `--target PATH` | 目标 Desktop 目录；默认 `~/Library/Application Support/Claude` |
| `--org UUID` | 目标账号下已有的组织目录；发现多个组织时必须显式指定 |
| `--backup-dir PATH` | 备份父目录；默认当前目录中的 `recovery-backups`，必须在 Claude 数据目录之外 |
| `--apply --yes` | 显式执行；仅新增，不覆盖已有会话 |
| `--report FILE` | 新建权限为 `0600` 的本地报告 |
| `--help` | 查看恢复命令帮助 |

`--target` 的 `config.json` 必须包含目标账号标识，且账号下已经有初始化的组织目录。该标识来自本地配置，不代表工具在线验证了当前身份。执行前请自行确认目标账号；工具不会替你登录、猜测组织或授予文件夹信任。

### 恢复哪些数据

- 从源目录读取本地 `local_*.json` Code 索引，与默认 `~/.claude/projects/<project>/<session-id>.jsonl` 主会话正文匹配。
- 同一 CLI 会话只计划一次，已有目标记录优先；重复执行跳过已经存在的记录。
- 正文缺失、为空、JSON 无法解析或存在内容不同的同名副本时跳过并报告。子智能体正文不会单独变成 Desktop 会话。
- 保留标题、时间、归档状态及必要本地路径；工作目录缺失会报告，不擅自改路径。查看历史成功不代表可以继续在已丢失的目录中工作。
- 只复制允许清单中的本地元数据，排除旧连接器、云端桥接、待执行动作等配置。恢复记录使用**手动权限，Remote Control 关闭**。
- 原索引、正文和 thinking 块均不改写；恢复不会发起新对话、执行历史工具调用或修改旧凭据。

### 跨组织 thinking 提示

可能看到：`Claude can't use thinking from another organization`。

这是历史推理块的兼容性提示，不能据此判断旧账号仍然登录。根据 [Anthropic preserved thinking 文档](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking#thinking-blocks-stay-with-the-account-that-produced-them)，部分模型的 thinking 绑定生成它的账号；跨组织发送时可能被 API 丢弃，请求仍可成功，但模型需要重新推理，可能增加延迟与 token 消耗。

**本工具选择保留完整历史。** 它统计 `thinking`、`redacted_thinking` 和带签名的块，不输出内容，不尝试解密签名、判断签名所属组织或重新签名。报告中的 `thinking.organizationCompatibility` 固定为 `not-verified`；检测到思考块只说明存在潜在兼容性限制，不证明每个块一定来自其他组织。

即使索引恢复、正文显示和保护校验都通过，也不能承诺新账号能复用旧思考。工具不会通过删除思考来隐藏提示，`uiVerified` 始终由命令报告为 `false`，需要在客户端另行验收。

### 备份、失败与报告

执行前创建权限为 `0700` 的独立备份目录，保存目标目录原文件及 `manifest.json`。备份可能含私有会话信息，**不要提交到 GitHub 或上传 Pages**；默认目录已加入 `.gitignore`。

受控写入失败时只尝试撤销本次新增的文件，原件和备份保留。强制结束进程、断电或撤销失败可能留下部分记录，不能当作完整事务；根据 manifest 的 `planned`、`created` 和 `status` 人工核对，不要整目录覆盖恢复后的新对话。

报告包含 `planned`、`created`、`skipped`、`missingWorkingDirectories`、`originalsUnchanged`、`backupDirectory`、`thinking` 和 `uiVerified`。`created: 0` 可能意味着会话已存在或全部被跳过；应查看原因，而不是假定全部恢复。报告路径和会话标识属于本地私有信息。

经验、实测边界和实现说明见 [本地对话恢复](docs/RECOVERY.md)。

## 命令参考

以下选项属于账号清理命令；恢复参数见上一节。

```text
node bin/reset.mjs [options]
```

| 选项 | 含义 |
| --- | --- |
| 无选项 | 检查默认规则，不修改原始 Claude 数据 |
| `--apply` | 执行清理；必须同时传入 `--yes` |
| `--yes` | 显式确认按所选规则清理；不会自动扩大清理范围 |
| `--traces` | 加入已知功能缓存、遥测及退出标记；本身不触发写入 |
| `--include-keychain` | 删除指定共享钥匙串项；必须与 `--apply` 一起使用 |
| `--profile PATH` | 指定 Desktop 数据目录，可重复传入 |
| `--report FILE` | 保存本地 JSON 报告，仅允许创建新文件 |
| `--help` | 查看帮助 |

### 指定 Desktop 数据目录

未传入 `--profile` 时，工具在当前用户的 `~/Library/Application Support/` 下发现 `Claude` 和 `Claude-*` 目录，包括 `Claude-3p`。目录名称本身不能证明它由多账号工具创建。

```sh
# 仅检查这个 Desktop 目录
node bin/reset.mjs --profile "$HOME/Library/Application Support/Claude"
```

```sh
# 检查多个指定目录
node bin/reset.mjs \
  --profile "$HOME/Library/Application Support/Claude" \
  --profile "$HOME/Library/Application Support/Claude-Work" \
  --traces
```

`--profile` **只限制 Desktop 目录**。默认 Claude Code 配置及其配置备份仍在处理范围内；钥匙串密钥也不是单个 profile 专属。

自定义 `CLAUDE_CONFIG_DIR` 不会被自动发现或重置，也不能通过 `--profile` 指定。执行前应人工确认这类配置。

### 保存报告

```sh
node bin/reset.mjs --traces --report before.report.json
node bin/reset.mjs --apply --yes --traces --report after.report.json
```

文件以 `0600` 权限创建；已有同名文件时，命令会在清理前停止。报告可能包含本地路径和字段名，分享前请检查。

## 清理范围

下表描述**执行清理时**的行为。默认检查只展示计划。

| 数据 | 重置登录 | 额外启用 `--traces` |
| --- | --- | --- |
| 已知 OAuth、账号标识和设备信任字段 | 从 JSON 配置中移除指定字段 | 相同 |
| Desktop 主 Cookie 数据库及对应日志 | 删除 | 相同 |
| `config.json.journal` | 删除，避免恢复旧配置状态 | 相同 |
| `remote-control-state.json` 的 `identities` | 清空映射，保留其他字段 | 相同 |
| 默认 Claude Code 的 `.credentials.json` | 如存在则删除 | 相同 |
| 默认 Claude Code 配置及其配置备份 | 移除已知账号字段，保留项目等配置 | 额外移除已知功能缓存 |
| Local Storage 的账号提示、同步归属、登录方式 | 按来源和键名精确删除 | 相同 |
| Local Storage 的遥测、退出及部分认证界面标记 | 保留 | 按规则删除 |
| 已知套餐用量文件、账号设备映射及功能缓存 | 保留 | 删除或清空 |
| `Claude Safe Storage / Claude Key` 钥匙串项 | 仅查询存在性 | 仍保留，需单独传入 `--include-keychain` |

Local Storage 规则只匹配 `https://claude.ai` 和 `app://localhost` 两种来源及明确的键名。其他来源、未知键、会话索引、草稿、会话结果和预设不在删除清单中。完整规则以 [`lib/core.mjs`](lib/core.mjs) 为准。

工具会检查以下默认 Claude Code 配置位置：

```text
~/.claude.json
~/.claude/.claude.json
~/.claude/backups/.claude.json.backup.*
~/.claude/.credentials.json
```

不是所有记录都能用于登录。例如账号标识用于提示或归属，遥测 ID 用于统计，退出标记用于客户端状态协调。`--traces` 把减少这些残留作为可选操作，不能据此推断它们都是认证凭据。

### 不会覆盖的范围

- IndexedDB、Session Storage 的内容解析或选择性清理。
- 未知账号字段、其他日志、会话内部的账号引用。
- Safari、Chrome 等外部浏览器中的登录状态。
- 系统环境变量、单独配置的 API key、企业 SSO 的完整认证链路。
- 自定义 Claude Code 配置目录及未发现的 Desktop profile。
- 云端聊天、服务器端 token、APFS 快照、备份和 SSD 上的数据恢复痕迹。

因此，报告成功不应解释为“所有旧账号记录均已消失”或“所有登录方式都已失效”。

## 会话保护与执行机制

### 受校验的文件

工具对以下已存在目录中的文件计算操作前后的 SHA-256，并比较文件集合及内容：

| 位置 | 目录 |
| --- | --- |
| 每个选中的 Desktop 数据目录 | `claude-code-sessions`、`local-agent-mode-sessions`、`side-session-notes`、`scratch-workspaces`、`git-shadow`、`IndexedDB`、`Session Storage` |
| 默认 `~/.claude/` | `projects`、`sessions`、`file-history`、`uploads` |

Local Storage 另外按键值校验：允许清单外的每条记录保持原值，选中的记录删除后回读确认。JSON 配置仅移除选定字段，写入后回读验证。

### 执行顺序

1. 检查进程和路径，要求 Claude 保持退出。
2. 解析目标配置，在临时副本中预读 Local Storage；记录受保护文件的校验值。
3. 仅在显式执行模式下修改已知目标。
4. 整理 LevelDB 的失效旧记录，验证保留记录；按选项处理钥匙串。
5. 回读清理结果，再次校验受保护文件，输出报告。

工具拒绝符号链接路径、无法解析的配置、数据库错误和无法完成的权限检查。它不会为继续执行而放宽这些检查。

**验证不等于备份。** 多文件操作不是全局事务；中途失败时，之前已完成的删除不会自动撤销。工具也不会复制旧令牌用于自动回滚。数据库整理不能保证已删除内容无法通过快照或磁盘取证恢复。

## 报告与退出状态

报告以 JSON 输出到终端；指定 `--report` 时同时保存到本地文件。

| 字段 | 如何理解 |
| --- | --- |
| `version` | 工具版本 |
| `mode` | `audit` 为检查，`apply` 为执行 |
| `traces` | 是否启用了扩展规则 |
| `keychain` | 指定钥匙串项的 `present`、`absent` 或 `deleted` 状态 |
| `changes` | 规则命中的配置与文件处理项目 |
| `localStorage` | 每个 profile 命中的键名、保留记录数与检查结果 |
| `protectedFiles` | 纳入会话保护校验的文件数量 |
| `historyUnchanged` | 受校验的文件集合与内容是否一致 |
| `limits` | 本次规则的覆盖限制 |

检查模式中的 `historyUnchanged: true` 表示检查前后这些文件未变化，**不表示已经执行清理**。`localStorage` 的 `verified` 也不能替代对 `mode` 的判断。

| 退出码 | 含义 |
| --- | --- |
| `0` | 帮助已输出，或所选操作及必要验证成功完成 |
| `1` | 参数、平台、进程、权限、数据格式、操作或校验发生错误 |

失败时错误写入标准错误，报告文件可能为空或未完整写入。不要仅根据文件存在判断清理成功；请结合退出码和终端错误。遇到保护校验失败时，停止使用 Claude 并检查本地数据。

## 隐私与数据处理

- 网页没有数据上传入口、第三方统计或外部脚本。
- 安装会访问 Cloudflare Pages 和 npm；检查与清理代码不发送网络请求。
- 不解密 Cookie 或钥匙串密钥；钥匙串默认只查询指定条目的存在性。配置会在本机内存中解析，正常 JSON 报告记录路径、键名和计数，不包含配置值。错误输出与报告仍应在分享前自行审阅。
- 检查 LevelDB 时会临时复制整个数据库，其中可能包含敏感内容。副本位于本机权限为 `0700` 的临时目录，正常退出及受控错误处理时删除。
- 强制终止、断电等情况可能留下临时目录，位于系统临时目录下，名称以 `claude-reset-` 开头。清理前应确认其来源及没有进程使用。
- 本地报告会处理 UUID 脱敏，但路径、profile 名称和未知字段名仍可能泄露信息，不能当作完全匿名数据公开上传。

## 常见问题

### 为什么已经退出账号，还要检查本地状态？

退出登录不一定会删除所有界面提示、账号归属和配置缓存。工具的作用是检查已知位置，再按明确范围清理；不是要求每次换账号都必须使用。

### 为什么要单独处理钥匙串？

`Claude Safe Storage` 是应用用于加密 Cookie 等数据的密钥，可能由多个 Desktop profile 共享。它与具体账号的密码或 token 不同，删除影响可能超出当前选择的目录，所以需要单独选择。

### 保留会话后，新账号一定能看到旧对话吗？

不能保证。工具保留本地文件，不修改会话归属，也不迁移云端聊天。新账号的显示和访问权限由 Claude 决定。

### 可以只清理一个 Desktop profile 吗？

可以通过 `--profile` 限制 Desktop 范围。但默认 Claude Code 配置仍会处理；选择删除钥匙串密钥时，其影响也可能跨 profile。当前没有单独关闭默认 Claude Code 处理的选项。

### 再次运行会重复删除或报错吗？

已删除的目标会跳过，已清理的字段不会再次命中。执行模式仍会整理 Local Storage 数据库，因此不保证数据库文件的物理字节保持不变；保留记录的逻辑值会重新校验。

### 提示 Claude 正在运行，或者无法检查进程怎么办？

完全退出 Desktop、Code 和相关任务后重试。如果运行在限制进程访问的沙箱中，请在正常 macOS 终端中执行。不要删除检查逻辑来强行继续。

### 提示配置损坏、符号链接或钥匙串访问失败怎么办？

先确认目录是否正确、文件是否由其他进程写入，以及系统访问权限。工具会停止，而不会猜测数据格式或跟随链接扩大范围。反馈问题时可提供脱敏后的错误和版本信息。

## 开发与部署

从仓库根目录执行：

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run build:site
```

合成数据测试覆盖只读检查不改动原库、精确删除、会话与草稿保护、配置备份、重复执行、异常 JSON、符号链接、钥匙串选项、UTF-16 键名和临时副本清理，不操作开发者的真实账号。

GitHub Actions 在 macOS 与 Node.js 22 上运行测试并构建下载包。初版还验证了线上 HTTP 内容、下载包校验和独立目录中的安装流程；浏览器视觉与交互未验证。

### 项目结构

```text
bin/reset.mjs          命令行入口、参数及报告输出
lib/core.mjs           发现、规则、清理与保护校验
bin/recover.mjs        本地 Code 会话恢复命令
lib/recovery.mjs       预览、去重、备份、thinking 检测与恢复
test/                 清理与恢复的合成数据测试
scripts/build-site.mjs 下载包、校验清单和安装脚本生成
site/                 静态网页与生成的下载文件
docs/LESSONS.md        原理、判断边界及经验
```

`site/downloads/` 是构建产物，不提交到 Git。构建生成工具包、`SHA256SUMS` 和内置包哈希的 `install.sh`。

### Cloudflare Pages

使用已登录、具有对应项目权限的 Wrangler 4 部署：

```sh
npm run build:site
wrangler pages deploy site --project-name claude-account-reset --branch main
```

仓库的 `wrangler.jsonc` 与安装脚本生成器配置了本项目名称和生产下载域名。部署自己的 fork 时，需要先调整项目名称与生成器中的下载地址，再构建。GitHub 测试通过不会自动部署网页。

恢复测试另外覆盖跨账号索引重建、重复运行、目标冲突、组织歧义、正文缺失、部分写入回退、thinking 统计与原始正文保留。新版工具只使用合成数据验收，未在真实账号上再次执行恢复。

## 参与贡献

欢迎提交问题、兼容性证据和范围明确的改进。

提交 Issue 时，请包含：

- macOS、Node.js、Claude 和工具版本。
- 所用参数、期望行为和实际错误；说明是检查模式还是执行模式。
- profile 是否使用自定义路径、符号链接或自定义 `CLAUDE_CONFIG_DIR`。
- 能复现问题的脱敏结构或合成数据。

**不要上传真实凭据、Cookie 数据库、钥匙串导出、会话内容或未经审阅的完整报告。** 凭据一旦泄露，应先通过相应服务撤销或轮换。

提交 Pull Request 时，请保持删除规则具体、可解释：新增字段应说明用途和证据，并用合成数据验证目标被移除、无关数据被保留。不要为通过测试而放宽保护检查。提交前运行 `npm test`；涉及网页或下载流程时同时运行 `npm run build:site`。

## 许可证与参考

项目采用 [MIT License](LICENSE)。

隔离范围分析参考了 [MultiClaude](https://github.com/QuentinCar0n/multiclaude) 的源码：Desktop 使用 `--user-data-dir`，Claude Code 使用 `CLAUDE_CONFIG_DIR`。这些实现有助于定位存储范围，但不是 Claude 所有认证机制的完整规范。本项目没有复制其 Swift 代码，不依赖安装 MultiClaude。

更多判断过程见 [原理与经验](docs/LESSONS.md)。

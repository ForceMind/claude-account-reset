# Claude Account Reset

**在 macOS 上审阅、清理已知 Claude 账号状态，恢复本地 Code 列表，或生成去掉旧 thinking 的接手文档。**

本分支交付 **v0.6.0 macOS 图形客户端候选版**。双击即可浏览、筛选和预览本地 Code 会话，保存本工具内的收藏与备注，查看只读环境概览，导出可见历史文档或备份原始正文。既有账号清理和文件恢复流程保留；无需安装 Node 或输入命令。账号切换、Windows、写入型历史维护图形入口仍属后续迭代。说明见 [桌面客户端](docs/DESKTOP.md)。下方网页链接对应此前公开的 v0.4.1 CLI/Skill 版本，不代表图形候选版已公开发布。

[![Verify](https://github.com/ForceMind/claude-account-reset/actions/workflows/test.yml/badge.svg)](https://github.com/ForceMind/claude-account-reset/actions/workflows/test.yml)
![macOS](https://img.shields.io/badge/platform-macOS-black)
![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-43853d)
[![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[网页与下载](https://claude-account-reset.pages.dev/) · [安全机制](docs/SAFETY.md) · [恢复经验](docs/RECOVERY.md) · [接手文档](docs/HANDOFF.md) · [反馈](https://github.com/ForceMind/claude-account-reset/issues)

**v0.4.1 是早期工具，采用“保存计划 → 审阅 → 校验备份 → 执行”的流程。** 未传执行参数时只预览原始数据。计划过期、目标不明确、备份不一致或空间不足时停止。

独立社区项目，与 Anthropic 无隶属关系。不能解除账号限制、保证设备匿名、迁移云端所有权或保证所有 Claude 版本兼容。最初规则基于 Desktop 4.29.0；新版实现使用合成数据验证，未在用户真实账号上再次执行，也未进行真实模型续聊或浏览器验收。

## 目录

- [选择入口](#选择入口)
- [交给 AI 使用](#交给-ai-使用)
- [安装与快速开始](#安装与快速开始)
- [命令参考](#命令参考)
- [选择和保护会话](#选择和保护会话)
- [多副本与续接](#多副本与续接)
- [账号与身份边界](#账号与身份边界)
- [备份验证与恢复](#备份验证与恢复)
- [报告与失败](#报告与失败)
- [隐私和限制](#隐私和限制)
- [开发与贡献](#开发与贡献)

## 选择入口

| 命令 | 用途 | 对正文的影响 |
| --- | --- | --- |
| `bin/reset.mjs` | 重置明确的登录字段、Cookie 和账号缓存 | 不改写对话正文 |
| `bin/recover.mjs` | 为目标账号新增缺失的本地 Code 索引 | 保留正文和 thinking |
| `bin/handoff.mjs` | 移除已知 thinking，生成可见历史文档，再补充索引 | **会改写选中的共享正文** |
| `bin/backup.mjs` | 检查备份、生成恢复计划、恢复指定条目 | 恢复会重新带回原内容，可能包括登录凭据 |

缓存目录、外部浏览器、硬件设备密钥不是本版自动清理目标。Cowork 与普通云端聊天暂不支持自动恢复。

## 交给 AI 使用

不会运行脚本时，可下载[完整 AI 工具包](https://claude-account-reset.pages.dev/downloads/claude-account-reset-0.4.1.tar.gz)，解压后，把**这个文件夹的本机路径**交给有本地文件和终端能力的 AI：

```text
请阅读这个文件夹中的 SKILL.md，按里面的流程帮助我使用工具。
先问清我的目标，只生成检查计划，解释会改什么、哪些会话会保留。
未经我确认，不要执行清理、恢复、thinking 改写或删除备份。
```

不需要先运行 `install.sh`。AI 可在解压目录中检查运行环境、安装锁定依赖、生成计划，再把影响解释给你；执行范围明确获授权后才继续。需要 Node.js 22+。纯网页聊天无法直接操作 Mac，需使用有本机执行能力的代理。

仓库根目录的 [SKILL.md](SKILL.md) 是入口，[agents/openai.yaml](agents/openai.yaml) 提供技能列表的显示信息。支持技能发现的宿主可按其规则把**整个文件夹**加入技能目录，再使用 `$claude-account-reset`；只复制 SKILL.md 会缺失脚本、锁文件和参考说明。未安装为全局技能，也可以直接让 AI 阅读本目录入口。

如果代理就是正在运行的 Claude Code，进程保护会拒绝本机操作；换用独立代理或普通终端，不绕过检查。Skill 不是远程清理服务，不自动上传本机资料。默认先预览，已有明确且仍适用的同等范围授权可沿用。

## 安装与快速开始

需要 **macOS、Node.js 22+ 和 npm**；从源码安装另需 Git。以自己的用户运行，不使用 `sudo`。操作期间完全退出 Claude Desktop、Code 及其后台任务。

### 网页下载

在[下载页面](https://claude-account-reset.pages.dev/)获取并阅读 `install.sh`：

```sh
bash install.sh
cd claude-account-reset-0.4.1
```

脚本新建版本目录，下载并校验工具包，按锁文件安装依赖。已有同名目录时停止。安装不扫描或修改 Claude 数据，只打印预览命令。也可下载[工具包](https://claude-account-reset.pages.dev/downloads/claude-account-reset-0.4.1.tar.gz)与 [SHA256SUMS](https://claude-account-reset.pages.dev/downloads/SHA256SUMS)自行校验。

### 从源码安装

```sh
git clone https://github.com/ForceMind/claude-account-reset.git
cd claude-account-reset
npm ci --ignore-scripts --no-audit --no-fund
```

项目没有发布到 npm。安装访问下载站和 npm；本地操作代码不发送网络请求。

### 两步执行

第一步生成私有计划，审阅终端摘要和计划文件中的目标、排除原因、身份、空间预算及限制：

```sh
node bin/reset.mjs --plan-out reset.plan.json
```

第二步单独执行已经审阅的计划：

```sh
node bin/reset.mjs --execute reset.plan.json --yes --report reset.report.json
```

**不要把这两条命令串成无人审阅的一键清理。** 计划文件不是“任意路径操作清单”：执行器会按当前规则重新发现并计算操作，只有范围、账号、组织、文件集合、哈希、权限和选项一致才继续。计划中的内容被改动或相关数据变化后，请重新预览。

> 从 v0.3 升级：单独的 `--apply --yes` 已拒绝执行。可用 `--apply --plan FILE --yes` 作为新执行方式的别名。旧报告不能冒充 v0.4 计划。

## 命令参考

### 公共参数

| 参数 | 作用 |
| --- | --- |
| `--plan-out FILE` | 保存完整计划；新文件、权限 `0600` |
| `--execute FILE --yes` | 执行保存的计划，不能再追加范围或删除选项 |
| `--report FILE` | 保存私有结果；已有文件时停止 |
| `--backup-dir DIR` | 计划中的备份父目录，默认 `./operation-backups` |
| `--discard-backup` | 写入计划：全部本地验证完成且无未解决候选项时，删除本批次备份 |
| `--help` | 显示帮助 |

不带 `--plan-out` 也可只预览，但要执行必须重新生成并保存计划。输入目录内部不能保存计划或报告。备份和文档目录必须在源数据之外，并使用不同目录树。

### 账号清理

```sh
# 仅处理指定 Desktop，不处理默认 Code 配置
node bin/reset.mjs --profile "$HOME/Library/Application Support/Claude" \
  --desktop-only --plan-out desktop.plan.json

# 同时选择已知功能/遥测缓存及某个 Code 配置目录
node bin/reset.mjs --traces --code-dir "$HOME/.claude-work" \
  --plan-out work.plan.json
```

`--profile`、`--code-dir` 可重复。不指定 Desktop 时发现 `Claude` 与相邻 `Claude-*`；不指定 Code 时选择默认 `~/.claude`。默认不会因为环境变量或发现 `.claude-*` 就自动扩大 Code 清理范围。

- `--traces`：已知账号功能缓存、遥测和退出标记；不是磁盘缓存清理。
- `--identity-records`：额外选择顶层 `userID`、`ant-did`、设备登记映射；默认保留。
- `--include-keychain`：额外选择 `Claude Safe Storage / Claude Key`，并记录不可文件恢复的影响；默认只查询存在性。

### 恢复和接手

```sh
node bin/recover.mjs --plan-out recover.plan.json
node bin/recover.mjs --execute recover.plan.json --yes
```

```sh
node bin/handoff.mjs --plan-out handoff.plan.json
node bin/handoff.mjs --execute handoff.plan.json --yes
```

登录目标账号并进入 Code 一次，然后退出。目标必须有明确账号标识和初始化的组织目录；多个组织时用 `--org UUID` 选择。工具不替你登录，不授予文件夹信任。

| 参数 | 作用 |
| --- | --- |
| `--source DIR` | Desktop 源目录，可重复；默认发现 `Claude*` |
| `--target DIR` | 目标 Desktop 目录，默认 `Claude` |
| `--org UUID` | 已存在的目标组织目录 |
| `--code-dir DIR` | 正文所在的 Code 配置目录，可重复 |
| `--session UUID` | 会话白名单，可重复；接受 Desktop ID（`local_…`）或 CLI ID |
| `--exclude UUID` | 排除名单，可重复，优先于纳入 |
| `--protect-since YYYY-MM-DD` | 保护该日期及以后的用户活动；时间未知也保护 |
| `--time-zone ZONE` | 启用日期保护时必须明确指定，如 `Asia/Shanghai` |
| `--baseline PRIOR_PLAN` | 保护基线后新建、正文/索引变化或 CLI 关联变化的会话 |
| `--output-dir DIR` | handoff 文档父目录，默认 `./handoff-documents` |

## 选择和保护会话

先预览取得真实会话 ID，再选择，不要依赖同名标题：

```sh
node bin/handoff.mjs --session local_11111111-1111-4111-8111-111111111111 \
  --exclude local_22222222-2222-4222-8222-222222222222 \
  --protect-since 2026-11-02 --time-zone Asia/Shanghai \
  --plan-out selected.plan.json
```

上述 ID 只是格式示例，必须换成自己的实际 ID。默认不猜测“今天”的时区或日期；未选日期参数时不会启用日期过滤。

计划显示标题、Desktop/CLI ID、当前目标索引关联、路径、归档状态、最后用户活动、thinking 计数和选择理由。用户角色中的自动续接或系统注入记录也可能触发保护，因此采用保守规则。不能只用文件修改时间判断是否续聊。

可以把先前的 v0.4 计划作为基线：

```sh
node bin/handoff.mjs --plan-out baseline.plan.json
# 之后重新预览时，保护基线后变化的会话
node bin/handoff.mjs --baseline baseline.plan.json --plan-out unchanged.plan.json
```

执行计划后出现新的会话或相关文件变化，会使计划过期，不会把新增数据偷偷加入执行范围。明确排除、日期保护和基线保护是已确定的范围决定；副本冲突、不可解析或缺失正文属于未解决项。

## 多副本与续接

| 情况 | 行为 |
| --- | --- |
| 单份正文 | 按规则处理 |
| 多份内容完全相同 | 标为重复文件，同一个逻辑会话 |
| 短本是长本的完整字节前缀 | 标为历史快照，以长本生成文档，各副本分别处理且保留各自可见内容 |
| 双方都有独有内容 | 标为分叉，跳过，不自动合并或取舍 |
| 同一 Desktop 会话出现不同 CLI ID | 默认保护；需明确选择某个 CLI ID |
| 正文缺失、为空、格式未知 | 跳过并报告 |

索引已存在时不覆盖。手动选择某个旧 CLI 日志，不会强制把当前索引改回旧日志。工作目录缺失会报告，不能保证继续运行；工具不猜测新路径。

## 账号与身份边界

| 类别 | 默认规则 |
| --- | --- |
| OAuth、`accountUuid`、`lastKnownAccountUuid`、已知设备信任字段 | reset 按明确顶层字段处理 |
| 主 Cookie、配置 journal、默认或选定 Code `.credentials.json` | reset 备份后处理 |
| `remote-control-state.json` 的身份映射 | reset 清空 identities，其余保留 |
| Local Storage | 仅匹配 `https://claude.ai` / `app://localhost` 和允许清单；验证其他键值不变 |
| `userID`、`ant-did`、设备登记文件 | 默认只审计，需 `--identity-records` |
| `machineID`、硬件/访问组密钥 | 保留，不宣称已轮换底层身份 |
| `Claude Safe Storage / Claude Key` | 仅存在性查询，需 `--include-keychain` 才删除 |
| 常见 `Claude Code-credentials` 服务 | 只审计；定制命名及访问组未全面覆盖，不自动删除 |
| 配置中 API key helper、认证环境变量 | 报告配置存在或变量名称，不记录值、不执行 helper、不修改 |
| 缓存、遥测目录、外部浏览器 | 缓存位置存在性审计和覆盖说明，不新增自动清理 |

v0.4 相比 v0.3 默认保留 `userID`，并增加顶层 `accountUuid` 的已知账号规则。未知键、项目设置、Skills/Hooks/MCP 等不因关键词匹配而删除。自定义 Code 目录下的已知配置/凭据可明确选择；自定义同名 sibling JSON 尚不自动编辑，报告中说明。

钥匙串查询区分 `present`、`absent` 和 `unavailable`。权限错误不是不存在。共享加密密钥删除可能影响其他 profile，文件备份不能恢复该密钥；不解密或导出它。

## 备份验证与恢复

执行器先检查源及目标磁盘空间，建立权限为 `0700` 的本批次目录。所有待改写/删除的源文件先复制、逐文件回读验证内容及结构；全部通过后才生成并验证暂存结果。写入前再次检查原计划和所有输入，完成后比较受保护数据。

```text
operation-backups/run-<plan-id>/
  journal.json       原计划、条目状态、哈希、验证结果和失败阶段
  payload/           经过回读验证的原件
```

默认保留备份。`--discard-backup` 需在生成计划时选择，仅在本批次全部检查成功且没有未解决候选项时删除该批次。它不等待真实模型/客户端验收；想先实际检查再决定时，不要使用该选项。失败不会自动清空备份，也不会自动覆盖新数据来回滚。

### 检查和恢复指定条目

```sh
node bin/backup.mjs --inspect /absolute/path/to/run-PLAN_ID
node bin/backup.mjs --restore /absolute/path/to/run-PLAN_ID --entry 0 \
  --plan-out restore.plan.json
node bin/backup.mjs --execute restore.plan.json --yes
```

替换为真实备份目录及条目编号。恢复前验证备份完整性，并保存当前状态；只恢复当前仍匹配原操作结果的条目。出现后续编辑会判为冲突，不提供盲目覆盖。恢复凭据可能重新登录旧账号，恢复 thinking 会带回旧思考。没有自动恢复钥匙串密钥的能力。

## 报告与失败

- 计划记录路径、身份标识、标题、哈希和规则，不保存正文或配置值；仍不是匿名数据。
- 成功报告区分操作完成、受保护数据验证、备份去留、文档位置以及未解决项。
- `uiVerified`、`modelVerified` 始终为 false；文件验证不能替代实际产品兼容性验收。
- `journal.json` 持续记录 `backing-up`、`staging`、`applying`、`complete` 或 `partial-or-stopped`，以及每个条目的进度。失败后先查看日志，不能把“有报告文件”理解为成功。
- 退出码 0 表示当前命令完成，1 表示停止或失败。预览完成不代表已执行。

流程不是跨文件事务，也不是抵御恶意并发写入的系统沙箱。强制结束、断电或应用在操作中重启，可能留下部分更改和暂存文件。不要盲目重跑旧计划或整目录恢复；先检查日志和恢复预览。

## 隐私和限制

保护范围包括所选 Desktop 的会话/笔记/工作区/IndexedDB/Session Storage，以及选定 Code 目录的 projects、sessions、history、file-history、uploads 和配置。所有相关输入结构、内容和权限参与计划校验；只有计划内目标允许变化。

Local Storage 预览使用本机私有临时副本，源数据库不打开写入。受控退出会清理副本；强制终止仍可能留下临时文件。计划、报告、文档和备份只留在本机，默认路径加入 Git 忽略列表；不要公开分享。

handoff 采用逐行流式转换，单行超过 8 MiB 或 UTF-8/结构异常时拒绝转换。仅移除已识别的 `thinking` / `redacted_thinking`，其他字段语义和消息链保留。纯思考消息保留结构与空 content，仍需确认客户端版本兼容性。

接手文档是可见历史摘录，包含用户消息、回答及工具记录，不是模型推断的任务总结。历史中的私人信息、可见凭据和旧指令可能仍在；二进制附件不嵌入。

[组织绑定的 thinking](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking)不能通过改账号标识或伪造签名来转换。保留模式可能由服务端丢弃旧思考并重新推理；handoff 不会把隐藏思考改写成普通文本。任何模式都不保证“全机无痕”、设备不可关联、所有缓存已清空或所有模型请求成功。

## 开发与贡献

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run build:site
```

测试使用临时目录与合成数据，覆盖计划注入/过期、空间和备份故障、恢复冲突、源数据保护、50 条会话选择、多副本、日期时区、CLI 续接、thinking、网页命令和资源边界。GitHub CI 使用 macOS、Node.js 22。

资源测试在 128 MiB V8 堆限制下处理约 32 MiB 和 160 MiB 合成历史，要求大文件超过堆上限仍成功且 RSS 增长受限；这不是对所有硬件与记录形态的性能保证。

```text
lib/planner.mjs       规则生成、会话选择、计划保存与过期校验
lib/engine.mjs        备份、暂存、执行日志、恢复预览与执行
lib/safety.mjs        路径、哈希、空间预算、私有复制和原子写入
lib/platform.mjs      进程与父进程检查、钥匙串状态
lib/transcripts.mjs   流式转换、用户活动和副本分类
lib/core.mjs          账号及 Local Storage 规则
lib/recovery.mjs      会话索引结构
lib/cli.mjs           所有命令的统一参数入口
```

### 部署自己的 fork

修改 `wrangler.jsonc` 中的项目名，以及 `scripts/build-site.mjs` 的下载域名，再构建和部署到自己的 Pages 项目：

```sh
npm run build:site
wrangler pages deploy site --project-name YOUR_PROJECT --branch main
```

GitHub CI 不自动部署。`site/downloads/` 为构建产物，不提交。下载包校验能检查完整性，不证明来源可信；请从可信仓库和域名获取。

### 问题与贡献

提交问题时提供版本、参数、预览/执行阶段、脱敏错误及可复现的合成结构。不要上传真实正文、Cookie、密钥、未审阅报告或备份。

新增规则需明确来源与影响，验证选中数据正确处理、其他数据保持不变。不要扩大白名单或隐藏失败来使测试通过。贡献前运行测试，涉及网站/分发时再构建下载包。

本项目采用 [MIT License](LICENSE)。隔离分析参考 [MultiClaude](https://github.com/QuentinCar0n/multiclaude)，备份流程比较参考 [claude-ban-clean](https://github.com/Pluviobyte/claude-ban-clean)；本版自行实现，没有复制其清理代码。更多记录见 [LESSONS.md](docs/LESSONS.md)。

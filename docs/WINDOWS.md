# Windows x64 候选客户端

v0.7.0 的 Windows 交付目标为 Windows 11 x64。构建验证使用 Windows runner，验证结果注明具体系统及已覆盖的操作。

## Claude Code

启动应用后选择 Code 资料目录。可以浏览与导出会话、查看脱敏环境配置，也可以生成登录状态清理计划。标准目录为 `%USERPROFILE%\.claude`，用户也可选择 `CLAUDE_CONFIG_DIR` 对应的本地目录。

计划列出已确认的配置字段和凭据文件，逐项核对后才能执行。执行前校验备份和 Windows 访问控制，操作后复核会话和原始文件权限。恢复同样需要计划，当前文件或权限冲突时停止。备份可能含旧登录信息，应存放在本机受保护目录。

## Claude Desktop

Windows 首批候选的 Desktop 入口用于浏览、环境检查与独立导出。目录发现覆盖常见 Roaming 资料和 Claude MSIX 的 Roaming 缓存候选。清理规则须依据已验证的应用布局与登录格式逐项开放。云端聊天、Cowork 和跨设备迁移沿用各自的产品边界。

## 验证和构建

在 Windows x64 运行 `npm ci --ignore-scripts --no-audit --no-fund`、`npm run test:windows` 和 `npm run desktop:make:windows`。Windows 工作流检验合成凭据和会话、文件占用、权限保全、恢复冲突、包内后台及已安装应用启动，并输出 EXE、便携 ZIP 和 `SHA256SUMS`。Apple Silicon 版本仍使用原有 macOS 打包命令。候选安装包的分发签名状态以交付记录为准。

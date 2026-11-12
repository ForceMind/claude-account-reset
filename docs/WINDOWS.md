# Windows x64 候选客户端

v0.7.0 的 Windows 交付目标为 Windows 11 x64。构建验证使用 Windows runner，验证结果注明具体系统及已覆盖的操作。

## Claude Code

启动应用后选择 Code 资料目录。可以浏览与导出会话、查看脱敏环境配置，也可以生成登录状态清理计划。标准目录为 `%USERPROFILE%\.claude`，用户也可选择 `CLAUDE_CONFIG_DIR` 对应的本地目录。

计划列出已确认的配置字段和凭据文件，逐项核对后才能执行。执行前校验备份和 Windows 访问控制，操作后复核会话和原始文件权限。恢复同样需要计划，当前文件或权限冲突时停止。备份可能含旧登录信息，应存放在本机受保护目录。

## Claude Desktop

Windows Desktop 的目录发现覆盖常见 Roaming 资料和 Claude MSIX 的 Roaming 缓存。官方 x64 MSIX `5.1231.2.0` 在干净 runner 上注册成功，并创建 `LocalCache\Roaming\Claude`。空白安装缺少登录数据库样本，独立的网页安装器下载请求返回 403。

对已识别的 MSIX 资料，清理计划检查 `config.json` 中已知登录字段，并对格式可识别的 Chromium Cookie 文件按名称和域名清除 `claude.ai` 的 `sessionKey`。事务文件存在或数据库格式未知时显示提示。规则通过合成资料验证，在线登录状态应在实际客户端确认。云端聊天、Cowork 和跨设备迁移沿用各自的产品边界。

## 验证和构建

在 Windows x64 运行 `npm ci --ignore-scripts --no-audit --no-fund`、`npm run test:windows` 和 `npm run desktop:make:windows`。Windows 工作流检验合成凭据和会话、文件占用、权限保全、恢复冲突、包内后台及已安装应用启动，并输出 EXE、便携 ZIP 和 `SHA256SUMS`。Apple Silicon 版本仍使用原有 macOS 打包命令。候选安装包的分发签名状态以交付记录为准。

候选版已在 GitHub Actions 的 Windows Server 2025 x64 runner 完成合成测试、安装和演示窗口启动。下载安装 EXE，或解压便携 ZIP 后打开 `Claude Account Reset.exe`。可用 PowerShell 的 `Get-FileHash -Algorithm SHA256` 和随包清单比对。安装器未签名。[候选构建产物](https://github.com/ForceMind/claude-account-reset/actions/runs/43189303993/artifacts/13929534199)

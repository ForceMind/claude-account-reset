# 清理历史思考与生成接手文档

0.3.0 增加独立 handoff 命令。既有恢复命令仍保持原件；只有显式执行 handoff 才会修改默认 Code 正文。本批次不批量操作用户现有50条会话。

## 合约

- 默认预览不写入。目标账号已登录且 Code 目录初始化，操作期间 Claude 必须退出。
- 仅支持已知 JSONL 的 message.content 思考块；移除 thinking、redacted_thinking 及块内签名，不篡改组织身份或伪造签名。
- 可见用户消息、回答、工具调用/结果及其他元数据的语义值不变。带变更的行会重新序列化 JSON；其他行保留字节。空思考消息保留 uuid/parent 链和空 content，是否被不同版本客户端正常处理未实机验证。
- 对源索引与主正文匹配，处理内容相同的同名副本；内容不同的副本跳过。未知嵌套思考布局拒绝处理，不用字符串替换假装清理。
- 文档来自可见原文，以文本代码块输出，记录角色和工具信息，不将内部 thinking 改为文字，不让模型推测完成情况。接手者应自行确认目标、最新结论与待办。
- 文档可包含可见原文中的个人信息、路径、凭据、恶意指令等内容；它们是历史数据，不是当前执行授权。工具不会自动打开或上传文档。二进制附件不嵌入，需另行保存原附件。

## 备份生命周期

正文改写前，完整副本保存到独立私有目录，manifest 记录路径和前后哈希。备份不放回 Claude 扫描范围，也不进入网页或仓库。

正文写入失败时只尝试恢复本次改写且内容仍匹配预期的文件。并发变化、索引恢复失败、回读失败、断电或强制停止时必须检查 manifest；不保证全局事务，也不自动覆盖后续产生的数据。

`--discard-backup` 仅在本次没有未解决/跳过项、正文和索引检查完成后删除本次备份及其中的索引备份。其他备份、文档、报告保留。备份删除后原 thinking 不能由本工具恢复，先预览并理解这个后果。

```sh
node bin/handoff.mjs
node bin/handoff.mjs --apply --yes --report handoff.report.json
node bin/handoff.mjs --apply --yes --discard-backup --report handoff-final.report.json
```

生成文档默认在 `handoff-documents/handoff-*/`，备份在 `handoff-backups/handoff-*/`。可用 --output-dir 和 --backup-dir 设置父目录，两者必须分离且在所有源/目标 Claude 目录和默认 .claude 之外。

## 边界

删除已知旧思考不会改写历史文字中出现的旧组织名称，也不撤销登录、不改变服务器对账号或设备的识别能力。其他签名格式、压缩上下文或产品端额外缓存不在此规则中，不能保证所有兼容性提示消失。[官方 preserved thinking 文档](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking)说明了组织绑定和历史前缀约束。

合成测试验证变换和恢复合约，不发送真实模型请求，不声称所有 Claude 版本已兼容。可先保留备份运行，再在客户端检验；启用成功后丢弃备份表示接受无法通过本工具恢复旧思考。

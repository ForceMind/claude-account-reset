# 交付记录

目标：发布可复用的 macOS CLI、公开 GitHub 源码、说明网页及可校验的下载包，部署 Cloudflare Pages。

当前批次：0.1.0。默认检查；清理、扩展痕迹、共享钥匙串分别显式选择。仅发布通用代码和匿名化经验。

验收：合成数据测试、脚本语法、下载包内容及哈希、静态页面链接、Git 远端回读、Pages 部署与 HTTP 内容回读。浏览器未验证。真实账号不再执行清理。

验证：9 项合成数据测试通过；网页本地资源链接、前端 JavaScript 与下载脚本语法检查通过。下载包在构建时生成 SHA-256。发布与 HTTP 回读待完成。

发布完成：公开仓库 https://github.com/ForceMind/claude-account-reset ，默认分支 main；Cloudflare Pages https://claude-account-reset.pages.dev 。GitHub macOS CI 的 9 项测试通过。

线上验收：使用 HTTP 客户端回读 HTML、CSS、JavaScript、安装脚本、校验清单和压缩包，与构建产物逐字节一致；包内置 SHA-256 校验通过。在独立临时工作目录实际运行线上安装脚本，下载、校验、解压及锁定依赖安装均成功。没有再次检查或清理真实账号。浏览器未验证。

GitHub 后续仅补充本交付记录，网页与下载包对应首个功能提交 dcdb322；运行时代码相同。

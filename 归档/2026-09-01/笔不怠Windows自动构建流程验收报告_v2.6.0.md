# Windows 自动构建流程验收报告 v2.6.0

结论：工程侧通过；首次真实 Windows 云构建待 GitHub 仓库接入后执行。

## 已完成

- 新增 GitHub Actions Windows 2025 x64 工作流，只允许手动触发或 `v版本号` 标签触发；标签必须与应用版本一致。
- 固定 Node.js 24.10.0、锁定 npm 依赖并使用 Rust stable，先跑 UI 基础、UI 质量、类型和全部单元/集成测试。
- Windows x64 Node SEA sidecar 改为跨平台调用 Postject JS 入口，避开 Windows `.cmd` 无法由 `execFileSync` 可靠执行的问题。
- Tauri 同时构建 NSIS `.exe` 和 MSI `.msi`；整理 SHA-256、Authenticode 状态和不含正文/密钥的构建证据。
- MSI 在临时 Windows 运行器中执行静默安装和卸载，保留结果与安装日志。
- 没有证书时明确标记 `unsigned-internal-test`；配置 PFX、密码和 HTTPS 时间戳后自动验证签名，流程结束时移除证书。
- 成功产物保留 14 天；失败运行在已有诊断文件时保留 7 天。工作流仅有仓库内容只读权限。

## 本机验收证据

- GitHub Actions YAML 可解析，Node 构建脚本语法检查通过，`git diff --check` 通过。
- 修改后的 SEA sidecar 在 macOS Apple Silicon 上重新生成并注入成功。
- 54 个测试文件、218 项测试全部通过，其中 Windows 工作流静态契约 3 项通过。
- UI 基础、UI 质量、双端 TypeScript、生产构建通过。
- 最终 Playwright 10 项全部通过。全量首次运行时 20 万字性能项受本机负载影响出现一次 10.6 秒超阈值；单项复跑为 7.3 秒，完整复跑为 6.6 秒，因此记录为负载抖动，不隐去首次失败。

## 尚未冒充完成

当前 `origin` 是 Gitee，GitHub Actions 不会在 Gitee 自动执行。本轮没有用户授权的 GitHub 仓库地址，因此没有擅自创建、公开或上传代码；也没有假造 `.exe`/`.msi`。

代码同步到 GitHub 后，需要手动运行一次工作流，以真实确认 Windows sidecar 注入、WiX/NSIS 构建、安装、卸载和 Artifact 下载。无证书包仍会触发 Windows“未知发布者”提示；自动烟测不替代 Windows 10/11、中文输入法、缩放、本地 Ollama 和崩溃恢复的真人测试。

实施与使用说明：[Windows x64 自动构建与内测交付](../../docs/implementation/WINDOWS_CI.md)。设计依据为 [Tauri GitHub Pipelines](https://v2.tauri.app/distribute/pipelines/github/) 和 [Tauri Windows Installer](https://v2.tauri.app/distribute/windows-installer/) 官方文档。

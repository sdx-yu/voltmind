# Windows 自动构建流程验收报告 v2.6.0

结论：通过。GitHub Windows 云端已真实生成 NSIS EXE 与简体中文 MSI，并完成 MSI 静默安装、卸载及证据上传。当前为未签名内测包，不可冒充正式公开发行包。

## 已完成

- 新增 GitHub Actions Windows 2022 x64 工作流，只允许手动触发或 `v版本号` 标签触发；标签必须与应用版本一致。
- 固定 Node.js 24.10.0、锁定 npm 依赖并使用 Rust stable，先跑 UI 基础、UI 质量、类型和全部单元/集成测试。
- Windows x64 Node SEA sidecar 改为跨平台调用 Postject JS 入口，避开 Windows `.cmd` 无法由 `execFileSync` 可靠执行的问题。
- Tauri 同时构建 NSIS `.exe` 和 MSI `.msi`；整理 SHA-256、Authenticode 状态和不含正文/密钥的构建证据。
- MSI 在临时 Windows 运行器中执行静默安装和卸载，保留结果与安装日志。
- 没有证书时明确标记 `unsigned-internal-test`；配置 PFX、密码和 HTTPS 时间戳后自动验证签名，流程结束时移除证书。
- 成功产物保留 14 天；失败运行在已有诊断文件时保留 7 天。工作流仅有仓库内容只读权限。
- MSI 明确使用 `zh-CN` 本地化与代码页，避免中文产品名在默认 `en-US` MSI 中无法编码；构建前运行 VBScript 引擎烟测。

## 本机验收证据

- GitHub Actions YAML 可解析，Node 构建脚本语法检查通过，`git diff --check` 通过。
- 修改后的 SEA sidecar 在 macOS Apple Silicon 上重新生成并注入成功。
- 54 个测试文件、218 项测试全部通过，其中 Windows 工作流静态契约 3 项通过。
- UI 基础、UI 质量、双端 TypeScript、生产构建通过。
- 最终 Playwright 10 项全部通过。全量首次运行时 20 万字性能项受本机负载影响出现一次 10.6 秒超阈值；单项复跑为 7.3 秒，完整复跑为 6.6 秒，因此记录为负载抖动，不隐去首次失败。

## GitHub 云端真实验收证据

- 公开仓库：`https://github.com/sdx-yu/voltmind`
- 成功运行：`https://github.com/sdx-yu/voltmind/actions/runs/33495684584`（第 5 次，`workflow_dispatch`）
- 源提交：`a426f1f2d47bfda6ec1d6498fd649c0e39acf9ba`
- 运行时间：2026-09-01 10:06:21Z 至 10:14:59Z
- Artifact：`bibudai-2.6.0-windows-x64-5`，70,920,684 bytes，保留至 2026-09-15 10:14:20Z
- `笔不怠_2.6.0_x64-setup.exe`：28,967,727 bytes；SHA-256 `26ce33451e4047ec920ab37a522d5d1d58ee5ef95af3cee8912a453466a55108`
- `笔不怠_2.6.0_x64_zh-CN.msi`：41,656,320 bytes；SHA-256 `d0cd8c118a3243a82769673f90c8f3e2add8aa749e7a2c820d52002470bdfe87`
- 构建证据 `status=PASSED`；Windows x64；两份安装包 `NotSigned`；证据不含证书或密码。
- MSI 烟测证据 `status=PASSED`；静默安装退出码 0、静默卸载退出码 0；未记录正文内容。
- 下载后的两个文件已在 macOS 本机重新计算 SHA-256，与云端 `SHA256SUMS` 完全一致，并已放入 `/Users/sundaxian/Downloads`。

## 边界与后续真人测试

无证书包仍会触发 Windows“未知发布者”提示；自动烟测证明安装机制可工作，但不替代 Windows 10/11、中文输入法、缩放、本地 Ollama 和崩溃恢复的真人测试。公开发行前需要代码签名证书和真实设备测试矩阵。

实施与使用说明：[Windows x64 自动构建与内测交付](../../docs/implementation/WINDOWS_CI.md)。设计依据为 [Tauri GitHub Pipelines](https://v2.tauri.app/distribute/pipelines/github/) 和 [Tauri Windows Installer](https://v2.tauri.app/distribute/windows-installer/) 官方文档。

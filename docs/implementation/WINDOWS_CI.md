# Windows x64 自动构建与内测交付

状态：工程流程已落地；GitHub Windows 云端第 10 次运行已于 2026-09-03 全量通过

## 给产品经理的结论

代码进入 GitHub 后，不需要准备 Windows 电脑也能生成 Windows 安装包。在仓库的 Actions 页面手动运行 `Windows x64 desktop package`，云端 Windows x64 机器会完成测试、打包、安装、卸载和校验，然后提供一个可下载的压缩产物。

当前代码已同步到公开 GitHub 仓库 [sdx-yu/voltmind](https://github.com/sdx-yu/voltmind)。`.github/workflows/windows-desktop.yml` 已在 Windows 云主机真实生成并验收安装包；Gitee 远端仍保留，不影响 GitHub Actions。

## 自动化流程

1. 只允许手动运行，或推送与 `package.json` 版本一致的 `v版本号` 标签；不会因每次提交自动消耗构建额度。
2. 使用固定的 Windows 2022 x64 云主机、Node.js 24.10.0、锁定依赖和 Rust stable；构建前实际运行一次 VBScript 烟测，确认 Tauri/WiX 的 MSI 校验引擎可用。Windows 2025 云镜像不再带兼容的传统 VBScript 功能，因此不用于当前 WiX v3 打包。
3. 先执行 UI 基础检查、UI 质量检查、双端类型检查和全部 Vitest 测试；任一失败即停止，不生成安装包。
4. 构建项目自己的 Windows x64 Node sidecar，再由 Tauri 生成 NSIS `.exe` 和简体中文 `zh-CN` MSI `.msi`；中文 MSI 使用与产品名匹配的代码页，避免默认 `en-US` 无法编码“笔不怠”。
5. 校验两个安装包的 SHA-256 和 Authenticode 状态，在临时 Windows 系统中静默安装、卸载 MSI。
6. 上传 `.exe`、`.msi`、`SHA256SUMS`、构建证据、安装/卸载证据和 MSI 日志，保留 14 天。

## 第一次使用

1. 打开 GitHub 仓库的 `Actions` 页面。
2. 选择 `Windows x64 desktop package`。
3. 点击 `Run workflow`，选择 `main` 后确认运行。
4. 等待全部步骤变绿，在本次运行页面底部下载名称类似 `bibudai-2.6.0-windows-x64-数字` 的 Artifact。
5. 解压后优先把 `*-setup.exe` 发给普通测试用户；`.msi` 可用于企业部署或安装回归。

GitHub Actions 是否产生费用取决于仓库可见性、账户套餐和当月用量；本流程通过“手动/版本标签触发”和 60 分钟超时控制用量，但不承诺云端额度永远免费。

## 已通过的真实运行

- 运行：[Windows x64 desktop package #10](https://github.com/sdx-yu/voltmind/actions/runs/33734664056)
- 源提交：`b76b9b975c6cade1cf494042a016f2446dfa0254`
- 结果：质量门禁、NSIS、简体中文 MSI、哈希/签名检查、MSI 静默安装和卸载、Artifact 上传全部通过
- Artifact：`bibudai-2.8.2-windows-x64-10`，GitHub 默认保留 14 天
- 当前产物未签名，只达到已知测试者内测交付标准，不是公开发行标准

## 未签名内测包

没有代码签名证书也能构建和安装，产物证据会明确标记为 `unsigned-internal-test`。Windows SmartScreen 可能显示“未知发布者”；只应发给已知测试者，并让对方先对照 `SHA256SUMS`。

这类包不是正式公开发行包。自动安装/卸载通过也不能代替真实用户对 Windows 10/11、缩放、中文输入法、Ollama、休眠恢复和杀进程恢复的验证。

## 可选正式签名

在 GitHub 仓库的 Actions secrets 中配置以下三项后，流程会自动导入证书、签名、验证签名并在最后清除证书：

- `WINDOWS_CERTIFICATE_BASE64`：PFX 文件的 Base64；
- `WINDOWS_CERTIFICATE_PASSWORD`：PFX 密码；
- `WINDOWS_TIMESTAMP_URL`：HTTPS RFC 3161 时间戳地址。

证书和密码不会进入安装包、构建证据或日志。正式公开分发仍需结合真实 Windows 测试矩阵和发布准入决定，不能仅凭“构建成功”判断上线。

## 真实测试者回传清单

- Windows 10/11 版本、x64 架构和屏幕缩放比例；
- `.exe` 能否完成安装、启动、退出和卸载；
- 微软拼音与搜狗拼音的组合输入、候选窗和回车行为；
- 新建作品、连续写作、重启后数据是否保留；
- 本机 Ollama 未安装、已安装和模型未下载三种提示是否准确；
- 强制结束程序后，正文恢复与版本历史是否正常；
- 只回传虚构测试文本，不回传真实书稿或隐私数据。

# G4-B 外部门执行工具包（1.6.0）

状态：执行工具包工程完成；外部四门仍按实况保持 `BLOCKED`，公开发布为 NO-GO。

G4-A 已把七门状态固化为机器证据。G4-B 不追加产品功能，而是消除“拿到证书/主机/设备后仍要临时写脚本”的执行缺口，并提供真实作者波次的产品外交付台本。

## 完成范围

1. Node SEA sidecar 支持经过 Node 官方 `SHASUMS256.txt` 校验的 macOS arm64/x64 与 Windows x64 运行时；
2. macOS 一键前检/构建：要求完整 Xcode、可用的 `Developer ID Application` 身份和 Apple 公证凭据；构建后复核 codesign、Gatekeeper、DMG 完整性及 app/DMG stapled ticket；
3. Windows 一键前检/构建：要求 Windows x64、当前用户证书库中的有效代码签名私钥和 RFC 3161 HTTPS 时间戳；构建 NSIS/MSI 后复核 Authenticode 与签名者指纹；
4. Windows 安装/卸载、微软拼音、搜狗拼音和强退恢复矩阵由 Windows 本机 PowerShell 收集，并记录安装包哈希、系统架构和已安装输入法；
5. `/mobile-acceptance.html` 在真机采集安全上下文、触控、PWA、本地健康和人工闭环结果；汇总器要求 360/390/430px、iOS Safari、Android Chrome、离线重开、弱网保存、PWA 更新、加密接力和中文组合输入全部通过；
6. 真实作者启动包提供产品外招募、同意、安全交付、支持、删除、节奏和停机规则，不发送邀请、不建立虚构名册；
7. 所有执行 JSON 都记录 Git 修订、时间、平台和制品 SHA-256，不记录证书私钥、Apple 密码、作者身份、联系方式或正文。

## 命令

```bash
# macOS：只前检；凭据完备后去掉 :preflight
npm run release:macos:preflight
npm run release:macos

# Windows x64 PowerShell：只前检；凭据完备后去掉 :preflight
npm run release:windows:preflight
npm run release:windows

# 收集 3 份真机 JSON 后汇总（输出参数必须放在输入文件后）
npm run release:mobile:verify -- ios-390.json android-360.json ios-430.json --output mobile-summary.json
```

macOS 凭据使用 Tauri/Apple 支持的环境变量：`APPLE_SIGNING_IDENTITY`，以及 App Store Connect API Key 三元组或 Apple ID 专用密码三元组。Windows 使用 `WINDOWS_CERTIFICATE_THUMBPRINT` 与 `WINDOWS_TIMESTAMP_URL`。命令只报告“已配置/未配置”，不会输出凭据值。

## 外部执行顺序

1. 在与待发布提交一致的干净工作树运行平台前检；
2. 在授权的构建主机执行正式构建，保留 JSON、安装包和 SHA-256；
3. 在不属于构建者日常环境的测试设备执行安装、首次启动、升级、卸载、输入法与故障恢复；
4. 移动端以 HTTPS 打开验收页，分别导出三档视口证据并附脱敏截图；
5. 研究负责人按《种子作者波次启动包》在产品外招募，产品内只接收作者主动导出的最小披露研究包；
6. 发布负责人进行人工真实性复核后，才可把相应 G4/R1 门更新为 PASS。JSON 格式通过本身不能证明人员或设备真实。

## 依据

- Apple 要求使用 Developer ID、hardened runtime、secure timestamp 并提交公证；`notarytool` 与 stapling 属于正式分发流程：[Apple Notarizing macOS software](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)。
- Tauri v2 支持平台配置文件，以及 Windows `certificateThumbprint`、`digestAlgorithm` 和 `timestampUrl`：[Tauri Configuration](https://v2.tauri.app/reference/config/)、[Windows Code Signing](https://v2.tauri.app/distribute/sign/windows/)。
- macOS 签名/公证环境变量与凭据组遵循 Tauri v2 官方说明：[macOS Code Signing](https://v2.tauri.app/zh-cn/distribute/sign/macos/)。

## 当前实况边界

当前开发主机没有有效 Developer ID 身份、完整 Xcode、Windows x64 主机、移动真机或真实作者名册。因此本阶段只能把执行能力做到就绪并生成真实 `BLOCKED` 前检，不能把外部门伪造为 PASS。外部条件到位时无需改产品代码，按上述命令即可继续。

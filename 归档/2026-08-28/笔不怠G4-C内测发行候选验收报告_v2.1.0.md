# 笔不怠 G4-C 内测发行候选验收报告 v2.1.0

日期：2026-08-28
阶段结论：**2.1.0 Apple Silicon 内测发行候选通过本机构建与运行验收；公开发布 NO-GO。**

## 1. 阶段范围

UI-A～UI-E 已完成本机工程验证。G4-C 不新增产品功能，只把当前 2.1.0 构建为可安装、可校验、可追溯的 macOS 内测候选，并用 G4 七门模型重新确认真实发布状态。

## 2. 内测制品

| 制品 | 大小 | SHA-256 |
|---|---:|---|
| `release/笔不怠_2.1.0_aarch64.app.zip` | 44,996,174 bytes | `fbdafdda4639bb69de5346bc8d4786e83d750955848099508883790d09b2376d` |
| `release/笔不怠_2.1.0_aarch64.dmg` | 44,967,469 bytes | `9db4328ddd6803fcb6b7d1d1cb3df0f3af49cba7d810f678334bbb874c35746c` |

`release/SHA256SUMS` 共记录 35 项发布物料，逐项执行 `shasum -a 256 -c` 全部通过。

## 3. 供应链与版本

- CycloneDX SBOM：格式 `CycloneDX`、规范 1.6、209 个组件；
- 生产依赖许可证清单：218 项；
- `npm audit --omit=dev --audit-level=high`：0 个漏洞；
- package、package-lock、Tauri、Cargo、Service Worker 与 App Info.plist 均为 2.1.0；
- 发布物料不包含证书私钥、公证密码、作者身份、联系方式或正文。

## 4. App、签名与运行验收

- 架构：arm64；标识：`com.bibudai.writer`；hardened runtime 已启用；
- 当前签名为 ad-hoc，`codesign --verify --deep --strict` 通过；这不等同于 Developer ID；
- sidecar entitlement 保留 `allow-jit` 与 `allow-unsigned-executable-memory`；
- `hdiutil verify` 对 2.1.0 DMG 的 GPT/HFS/CRC 校验全部通过；
- 真实启动刚构建的 `.app` 后，sidecar 只监听随机回环端口 `127.0.0.1:54874`；
- `/api/health` 返回 `ok=true`、`integrity=ok`、`rescueMode=false`，首页标题为“笔不怠 · 笔耕不怠，写尽所思。”；
- 验收结束后 App 与 sidecar 均已退出，端口不再监听；启动按既有策略在应用数据目录创建可恢复快照。

## 5. 完整回归

- UI 基础与 UI 质量静态门：通过；
- TypeScript 客户端/服务端：通过；
- Vitest：46 个测试文件、167 项测试全部通过；
- Vite：2246 个模块完成生产构建；
- Playwright + macOS Google Chrome：8 条浏览器旅程全部通过；
- 首轮总门曾发现浏览器测试只等待 Vite、未等待 API 的启动竞态；已增加最长 8 秒的有限 API 就绪重试，独立 E2E 和完整 `npm run check` 均稳定复跑通过；
- Rust/Tauri release 构建成功。

## 6. 七项发布门实况

| 门 | 状态 | 依据 |
|---|---|---|
| G4-SOURCE | BLOCKED | 四处版本一致，但 UI-A～UI-E 当前累积改动尚未提交，受跟踪工作树非干净 |
| G4-MATERIALS | PASS | SBOM、许可证、DMG 与 35 项 SHA-256 可验证 |
| G4-MAC-BUILD | PASS | App 严格签名结构和 DMG 完整性通过 |
| G4-MAC-DISTRIBUTION | BLOCKED | 当前只有 Command Line Tools，缺 Developer ID、完整 Xcode、公证凭据和 stapled ticket |
| G4-WINDOWS | BLOCKED | 缺 Windows x64 签名安装包及安装/卸载/IME/恢复真机矩阵 |
| G4-MOBILE | BLOCKED | 缺 iOS/Android 真机、HTTPS PWA、弱网、离线与更新证据 |
| R1-SEED | BLOCKED | 缺 5 名两周、3 名四周真实作者与自然时间证据 |

机器证据的最终结论为 `NO-GO`。正式 macOS 分发前检按预期以退出码 2 返回 `BLOCKED`，缺少项为完整 Xcode、Developer ID 身份和公证凭据。

## 7. 证据与下一步

- [七门机器证据](笔不怠G4-C公开发布门证据_v2.1.0.json)
- [macOS 正式分发前检](笔不怠G4-C-macOS正式分发前检_v2.1.0.json)

当前可以分发给明确知情的 Apple Silicon 内部测试者，但不能宣传为已签名、公证或公开发布版本。下一步只有两类：提交并冻结当前源码以解除 G4-SOURCE；或在真实外部条件到位后执行 G4-B 工具包。不得继续用新增本机功能替代 Windows、移动真机、真实作者或正式分发验证。

# 笔不怠 G4-A 公开发布门预检验收报告 v1.6.0

验收日期：2026-08-27（Asia/Singapore）

实现基线：`0f99a722d7ad6f99d4e719d28665cb45106736df`

阶段结论：**G4-A 本机发布门预检通过；公开发布 NO-GO。**

## 一、交付结果

G4-A 没有追加产品功能，而是把 R1 的公开发布条件收敛成 `g4-release-readiness-v1` 七项门。检查器可复跑源码/版本、供应链材料、当前安装包、macOS 构建与正式分发状态，并显式保留 Windows、移动真机和真实作者外部门。

机器证据：[笔不怠 G4-A 公开发布门预检证据 v1.6.0](笔不怠G4-A公开发布门预检证据_v1.6.0.json)。

## 二、自动化与构建证据

| 检查 | 结果 |
|---|---|
| TypeScript | `npm run typecheck` 通过 |
| 决策单元测试 | 缺外部证据时保持 NO-GO、七门全通过才 GO，2/2 通过 |
| 全量自动化 | 37 个测试文件、134 项测试全部通过，0 失败 |
| 生产构建 | Vite 2,155 模块通过，产物完整生成 |
| 供应链 | CycloneDX 1.6 SBOM、第三方许可证 JSON 可解析且 SHA-256 已入清单 |
| 生产依赖审计 | `npm audit --omit=dev --audit-level=high`：0 漏洞 |

宿主机持续高负载使既有加密/SQLite 集成测试超过原默认 5 秒；失败均为超时而非断言错误，定向复验 11/11 通过。随后把全局测试与 hook 上限设为有限的 60 秒，完整套件在 407.15 秒内 134/134 通过。真正超过 60 秒的挂起仍会失败。

## 三、发布门结果

| 门 | 状态 | 实查结果 |
|---|---|---|
| G4-SOURCE | PASS | package/Tauri/Cargo/Service Worker 均为 1.6.0；基线提交无受跟踪改动 |
| G4-MATERIALS | PASS | SBOM、许可证与 1.6.0 DMG 哈希均存在、有效且与 `release/SHA256SUMS` 一致 |
| G4-MAC-BUILD | PASS | `.app` 严格签名结构通过；DMG 存在且 `hdiutil verify` 通过 |
| G4-MAC-DISTRIBUTION | BLOCKED | 不是 Developer ID 签名；Gatekeeper 未接受；无 stapled 公证票据 |
| G4-WINDOWS | BLOCKED | 没有 Windows x64 签名安装包及安装/卸载/中文输入法/恢复真机矩阵 |
| G4-MOBILE | BLOCKED | 没有 360/390/430px 真实设备的离线、弱网、PWA 更新与加密接力矩阵 |
| R1-SEED | BLOCKED | 真实波次未开始；没有至少 5 名两周、3 名四周的真实作者证据 |

当前可复核哈希：

- SBOM：`b34fff17c7a18c7a8c988ae48cf7148133ec51249a95958111c0099570ce7367`
- 第三方许可证：`e7506b0d95678d88b8c548de0d86fe2680336cbf5c2632adfa9985e819214709`
- 1.6.0 DMG：`99fcd4aefe69613bf89e050a80ad412e16848ecd2a57b9e5456095d39dcccea0`

## 四、隐私与真实性边界

最终 JSON 不含作者身份、联系方式、书稿正文或密钥，且明确 `fixtureEvidenceAccepted=false`。ad-hoc 签名、工程演练、存在但未验签的安装文件和浏览器响应式测试均不能替代正式签名、真机或真实作者证据。

## 五、验收结论与下一门

G4-A 的规格、检查器、决策测试、供应链校验、macOS 实查、阻塞矩阵和归档均完成，本机工程验收通过。由于四个外部门仍为 BLOCKED，整体 `releaseDecision` 与 R1 必须保持 NO-GO。

下一步不再新增本机产品功能：由研究负责人在产品外启动真实受控波次；并在获得 Developer ID/公证权限、Windows x64 环境/证书和真实移动设备后，分别补齐 G4-MAC-DISTRIBUTION、G4-WINDOWS、G4-MOBILE 与 R1-SEED 证据。

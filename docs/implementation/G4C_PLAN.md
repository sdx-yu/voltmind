# G4-C UI 内测发行候选（2.1.0）

基线：[G4-A 公开发布门预检](G4A_PLAN.md)、[G4-B 外部门执行工具包](G4B_PLAN.md)、[UI-E 质量门与收尾](UIE_PLAN.md)

状态：2.1.0 Apple Silicon 内测候选已完成本机构建与验收（2026-08-28）；公开发布保持 NO-GO。

## 目标

不再追加产品功能，把 UI-A～UI-E 已通过的 2.1.0 源码构建成可安装、可校验、可追溯的 Apple Silicon 内测候选，并用现有七门模型重新确认哪些证据真实通过、哪些仍被外部条件阻塞。

## 冻结范围

1. 重新生成 CycloneDX 1.6 SBOM、生产依赖许可证清单并执行生产依赖审计；
2. 构建 `笔不怠.app` 与 `笔不怠_2.1.0_aarch64.dmg`；
3. 生成 `.app.zip`，将两个内测制品复制到 `release/` 并刷新全目录 SHA-256；
4. 校验四处版本、Info.plist、严格签名结构、sidecar entitlement、DMG CRC 和真实桌面启动；
5. 输出 `g4-release-readiness-v1` 机器证据，按实况保留 Developer ID/公证、Windows、移动真机与真实作者门；
6. 复跑 UI-E 总门、Rust/Tauri 检查并归档报告与证据。

## 完成定义

- App、DMG、App ZIP、SBOM、许可证和 SHA-256 相互一致；
- `codesign --verify --deep --strict` 与 `hdiutil verify` 通过；
- sidecar 仍带 V8 所需 JIT entitlement，应用实际启动后本地健康接口可达；
- G4-SOURCE 如因未提交工作树保持 BLOCKED，报告必须明确原因，不把源码门伪装为 PASS；
- G4-MATERIALS 与 G4-MAC-BUILD 以实际证据决定；
- G4-MAC-DISTRIBUTION、G4-WINDOWS、G4-MOBILE、R1-SEED 在缺少真实条件时继续 BLOCKED；
- 公开发布结论仅在七门全部 PASS 时才允许变更为 GO。

## 非目标

- 不创建 Developer ID、Apple 公证、Windows 或移动真机假证据；
- 不生成真实作者、周期或留存数据；
- 不修改同步、研究、权限、数据库或编辑器协议；
- 不因内测候选构建成功改变公开发布 NO-GO。

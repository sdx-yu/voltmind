# 笔不怠

**笔耕不怠，写尽所思。**

中文长篇作者的本地优先剧情操作系统。MVP、RC1、V1-A～V1-M、V2-R～V2-V、R1-A～R1-C 执行能力与 UI-A～UI-F 已完成本机工程验证；真实种子作者、真实两周周期、跨平台正式分发与公开发布仍为 NO-GO，当前版本为 2.2.0。

## 开发

要求 Node.js 24 或更高版本。

```bash
npm install
npm run dev
```

- 本地界面：`http://127.0.0.1:4318`
- 本地 API：`http://127.0.0.1:4317`
- 数据默认保存在仓库的 `data/`，不会发送到远程服务。

## 校验

```bash
npm run check
```

## 桌面构建与正式发布前检

```bash
npm run desktop:build
npm run release:materials
npm run release:checksums
npm run release:macos:preflight
# Windows x64 主机：npm run release:windows:preflight
```

- Tauri/Rust 工具链存放在项目 `.tooling/`，不会修改全局 shell 配置；
- sidecar 使用 SHA-256 校验过的 Node 官方运行时，终端用户无需安装 Node；
- 构建物位于 `src-tauri/target/release/bundle/`；RC1 交付副本与 SBOM 位于 `release/`；
- 当前为 Apple Silicon ad-hoc 签名内测包，尚未 Developer ID 签名或 Apple 公证；正式凭据到位后使用 `npm run release:macos`；
- Windows x64 已具备官方 Node runtime sidecar、NSIS/MSI、证书前检和 Authenticode 复核脚本，必须在 Windows 主机执行；
- 移动真机打开 `/mobile-acceptance.html` 采集证据，使用 `npm run release:mobile:verify -- <三个 JSON>` 汇总。

## 文档

- [实施计划与追踪](docs/implementation/PLAN.md)
- [UI 统一规划与设计方案 v1.0](docs/implementation/UI_SYSTEM_PLAN_V1.md)
- [UI-A 设计基础计划](docs/implementation/UIA_PLAN.md)
- [UI-B 壳层与信息架构计划](docs/implementation/UIB_PLAN.md)
- [UI-C 页面模板与核心工作台计划](docs/implementation/UIC_PLAN.md)
- [UI-D 长尾工作流统一计划](docs/implementation/UID_PLAN.md)
- [UI-E 质量门与收尾计划](docs/implementation/UIE_PLAN.md)
- [UI-F 表单与浮层统一计划](docs/implementation/UIF_PLAN.md)
- [UI 贡献与新增页面准入规范](docs/implementation/UI_CONTRIBUTION_GUIDE.md)
- [G4-C UI 内测发行候选计划](docs/implementation/G4C_PLAN.md)
- [需求追踪矩阵](docs/implementation/TRACEABILITY.md)
- [架构决策 ADR-001](docs/adr/ADR-001-local-node-sqlite.md)
- [架构决策 ADR-002](docs/adr/ADR-002-tauri-sidecar-desktop.md)
- [架构决策 ADR-003](docs/adr/ADR-003-encrypted-handoff-sync.md)
- [架构决策 ADR-004](docs/adr/ADR-004-mobile-offline-event-union.md)
- [架构决策 ADR-005](docs/adr/ADR-005-offline-role-review-relay.md)
- [架构决策 ADR-006](docs/adr/ADR-006-trustworthy-local-sprint-results.md)
- [架构决策 ADR-007](docs/adr/ADR-007-declarative-local-template-packages.md)
- [架构决策 ADR-008](docs/adr/ADR-008-canon-before-visual-assets.md)
- [架构决策 ADR-009](docs/adr/ADR-009-local-consented-research-evidence.md)
- [架构决策 ADR-010](docs/adr/ADR-010-attested-cohort-evidence.md)
- [架构决策 ADR-011](docs/adr/ADR-011-controlled-research-waves.md)
- [bbd-sync-v1 协议与威胁模型](docs/implementation/SYNC_PROTOCOL_V1.md)
- [bbd-review-v1 协议与威胁模型](docs/implementation/REVIEW_PROTOCOL_V1.md)
- [bbd-sprint-v1 协议与威胁模型](docs/implementation/SPRINT_PROTOCOL_V1.md)
- [bbd-template-v1 协议与威胁模型](docs/implementation/TEMPLATE_PROTOCOL_V1.md)
- [bbd-visual-v1 协议与威胁模型](docs/implementation/VISUAL_ASSET_PROTOCOL_V1.md)
- [bbd-research-v1 最小披露研究协议](docs/implementation/RESEARCH_PROTOCOL_V1.md)
- [r1b-cohort-v1 受控种子证据协议](docs/implementation/COHORT_PROTOCOL_V1.md)
- [r1c-wave-v1 受控波次协议](docs/implementation/WAVE_PROTOCOL_V1.md)
- [V2-R 角色化审阅接力](docs/implementation/V2R_PLAN.md)
- [V2-F 安静冲刺与小组目标](docs/implementation/V2F_PLAN.md)
- [V2-P 本地插件与结构模板包](docs/implementation/V2P_PLAN.md)
- [V2-V 视觉锚点与故事板](docs/implementation/V2V_PLAN.md)
- [MVP 实施与验收报告](归档/2026-08-26/笔不怠MVP实施与验收报告_v1.0.md)
- [RC1 桌面交付与恢复验收报告](归档/2026-08-26/笔不怠RC1桌面交付与恢复验收报告_v0.2.0.md)
- [V1-A 剧情控制层实施与验收报告](归档/2026-08-26/笔不怠V1-A剧情控制层实施与验收报告_v0.3.0.md)
- [V1-B 视角知识层实施与验收报告](归档/2026-08-26/笔不怠V1-B视角知识层实施与验收报告_v0.4.0.md)
- [V1-C 系列正典层实施与验收报告](归档/2026-08-26/笔不怠V1-C系列正典层实施与验收报告_v0.5.0.md)
- [V1-D 交付体验层实施与验收报告](归档/2026-08-26/笔不怠V1-D交付体验层实施与验收报告_v0.6.0.md)
- [V1-E 来源证明层实施与验收报告](归档/2026-08-26/笔不怠V1-E来源证明层实施与验收报告_v0.7.0.md)
- [V1-S 加密同步工程验收报告](归档/2026-08-27/笔不怠V1-S加密同步工程验收报告_v0.8.0.md)
- [V1-M 移动收集与审阅验收报告](归档/2026-08-27/笔不怠V1-M移动收集与审阅验收报告_v0.9.0.md)
- [V2-R 角色化审阅接力验收报告](归档/2026-08-27/笔不怠V2-R角色化审阅接力验收报告_v1.0.0.md)
- [V2-F 安静冲刺与小组目标验收报告](归档/2026-08-27/笔不怠V2-F安静冲刺与小组目标验收报告_v1.1.0.md)
- [V2-P 本地插件与结构模板包验收报告](归档/2026-08-27/笔不怠V2-P本地插件与结构模板包验收报告_v1.2.0.md)
- [V2-V 视觉锚点与故事板验收报告](归档/2026-08-27/笔不怠V2-V视觉锚点与故事板验收报告_v1.3.0.md)
- [R1-A 真实验证基础设施验收报告](归档/2026-08-27/笔不怠R1-A真实验证基础设施验收报告_v1.4.0.md)
- [R1-B 受控种子研究台验收报告](归档/2026-08-27/笔不怠R1-B受控种子研究台验收报告_v1.5.0.md)
- [R1-C 受控两周波次执行验收报告](归档/2026-08-27/笔不怠R1-C受控两周波次执行验收报告_v1.6.0.md)
- [UI-A 设计基础验收报告](归档/2026-08-28/笔不怠UI-A设计基础验收报告_v1.7.0.md)
- [UI-B 壳层与信息架构验收报告](归档/2026-08-28/笔不怠UI-B壳层与信息架构验收报告_v1.8.0.md)
- [UI-C 页面模板与核心工作台验收报告](归档/2026-08-28/笔不怠UI-C页面模板与核心工作台验收报告_v1.9.0.md)
- [UI-D 长尾工作流统一验收报告](归档/2026-08-28/笔不怠UI-D长尾工作流统一验收报告_v2.0.0.md)
- [UI-E 质量门与收尾验收报告](归档/2026-08-28/笔不怠UI-E质量门与收尾验收报告_v2.1.0.md)
- [UI-F 表单与浮层统一验收报告](归档/2026-08-28/笔不怠UI-F表单与浮层统一验收报告_v2.2.0.md)
- [G4-C 内测发行候选验收报告](归档/2026-08-28/笔不怠G4-C内测发行候选验收报告_v2.1.0.md)
- [下一阶段 R1 真实作者验证与公开发布门](docs/implementation/R1_PLAN.md)
- [R1-A 真实验证基础设施](docs/implementation/R1A_PLAN.md)
- [R1-B 受控种子研究台](docs/implementation/R1B_PLAN.md)
- [R1-C 受控两周波次执行](docs/implementation/R1C_PLAN.md)
- [G4-B 外部门执行工具包](docs/implementation/G4B_PLAN.md)
- [种子作者波次启动包](docs/user/SEED_WAVE_LAUNCH_KIT.md)
- [移动收集与审阅指南](docs/user/MOBILE_COMPANION.md)
- [角色化审阅接力指南](docs/user/ROLE_REVIEW.md)
- [安静冲刺与小组目标指南](docs/user/QUIET_SPRINTS.md)
- [本地结构模板指南](docs/user/LOCAL_TEMPLATES.md)
- [视觉锚点与故事板指南](docs/user/VISUAL_STORYBOARDS.md)
- [真实作者验证指南](docs/user/REAL_AUTHOR_VALIDATION.md)
- [受控种子研究台指南](docs/user/RESEARCH_COORDINATOR.md)
- [受控波次执行指南](docs/user/CONTROLLED_WAVES.md)
- [备份与恢复指南](docs/user/BACKUP_AND_RECOVERY.md)
- [隐私说明](docs/user/PRIVACY.md)

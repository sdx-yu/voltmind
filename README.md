# 笔不怠

**笔耕不怠，写尽所思。**

中文长篇作者的本地优先剧情操作系统。MVP、RC1 与 V1-A～V1-S 已完成本机工程验证，当前版本为 0.8.0。

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

## macOS 桌面构建

```bash
npm run desktop:build
npm run release:materials
```

- Tauri/Rust 工具链存放在项目 `.tooling/`，不会修改全局 shell 配置；
- sidecar 使用 SHA-256 校验过的 Node 官方运行时，终端用户无需安装 Node；
- 构建物位于 `src-tauri/target/release/bundle/`；RC1 交付副本与 SBOM 位于 `release/`；
- 当前为 Apple Silicon ad-hoc 签名内测包，尚未 Developer ID 签名或 Apple 公证。

## 文档

- [实施计划与追踪](docs/implementation/PLAN.md)
- [需求追踪矩阵](docs/implementation/TRACEABILITY.md)
- [架构决策 ADR-001](docs/adr/ADR-001-local-node-sqlite.md)
- [架构决策 ADR-002](docs/adr/ADR-002-tauri-sidecar-desktop.md)
- [架构决策 ADR-003](docs/adr/ADR-003-encrypted-handoff-sync.md)
- [bbd-sync-v1 协议与威胁模型](docs/implementation/SYNC_PROTOCOL_V1.md)
- [MVP 实施与验收报告](归档/2026-08-26/笔不怠MVP实施与验收报告_v1.0.md)
- [RC1 桌面交付与恢复验收报告](归档/2026-08-26/笔不怠RC1桌面交付与恢复验收报告_v0.2.0.md)
- [V1-A 剧情控制层实施与验收报告](归档/2026-08-26/笔不怠V1-A剧情控制层实施与验收报告_v0.3.0.md)
- [V1-B 视角知识层实施与验收报告](归档/2026-08-26/笔不怠V1-B视角知识层实施与验收报告_v0.4.0.md)
- [V1-C 系列正典层实施与验收报告](归档/2026-08-26/笔不怠V1-C系列正典层实施与验收报告_v0.5.0.md)
- [V1-D 交付体验层实施与验收报告](归档/2026-08-26/笔不怠V1-D交付体验层实施与验收报告_v0.6.0.md)
- [V1-E 来源证明层实施与验收报告](归档/2026-08-26/笔不怠V1-E来源证明层实施与验收报告_v0.7.0.md)
- [V1-S 加密同步工程验收报告](归档/2026-08-27/笔不怠V1-S加密同步工程验收报告_v0.8.0.md)
- [备份与恢复指南](docs/user/BACKUP_AND_RECOVERY.md)
- [隐私说明](docs/user/PRIVACY.md)

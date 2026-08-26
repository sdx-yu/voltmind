# 笔不怠 RC1 桌面交付与恢复验收报告 v0.2.0

- 日期：2026-08-26
- 基线：MVP v1.0 本机功能通过
- 阶段：G4 发布门禁加固 / RC1
- 结论：**macOS Apple Silicon 内部 dogfood GO；公开发布 NO-GO**

## 1. 本阶段交付

### 桌面交付

- Tauri 2 管理原生窗口、系统应用数据目录和 sidecar 生命周期；
- 服务端以 Node 24 SEA 打成自包含 Mach-O sidecar，终端用户无需安装 Node；
- 构建脚本下载 Node 官方发行包，并以官方 `SHASUMS256.txt` 校验。本轮 `node-v24.10.0-darwin-arm64.tar.gz` SHA-256 为 `fbc3d6e1e1d962450d058e918214373872cc4c46e08673f31c35932afac4a8c5`；
- 启动时选择随机 `127.0.0.1` 端口，WebView 与 API 保持同源，继续使用 HttpOnly、SameSite=Strict 会话；
- macOS 数据目录为 `~/Library/Application Support/com.bibudai.writer/`；
- 生成 `.app` 和 Apple Silicon DMG，应用包包含 V8 JIT 所需 entitlement。

### 损坏数据库救援

- 启动时主库打不开或 `PRAGMA integrity_check` 非 `ok`，停止常规读写并进入安全救援模式；
- 逐个只读打开快照并标记完整/失败，拒绝路径穿越和坏快照；
- 页面内两阶段确认明确展示恢复来源和后果；
- 恢复前把异常主库及 WAL/SHM 移入 `recovery`，不删除原件；
- 恢复副本二次完整性检查通过后原子替换主库，并在同一服务进程中重新激活正常应用。

### 发布治理

- CycloneDX 1.6 生产依赖 SBOM；
- 177 个运行时包的许可证和来源清单；
- 隐私说明、备份恢复指南、故障反馈模板和内置“帮助与恢复”页签；
- ADR-002 记录 Tauri + Node sidecar 的原因、代价和回滚路径。

## 2. 自动化与浏览器验收

| 项目 | 结果 |
|---|---|
| TypeScript 类型检查 | 通过 |
| Vitest | 6 个文件、26 项测试全部通过 |
| 生产前端构建 | 通过；最大单 chunk 394.56 kB |
| npm 高危漏洞审计 | 0 个已知漏洞 |
| 快照恢复故障注入 | 坏主库隔离、有效快照恢复、坏快照标记、路径穿越阻断均通过 |
| 救援浏览器闭环 | 进入救援 → 选择完整快照 → 两阶段确认 → 自动回到书架，通过 |
| 内置帮助 | 备份、异常救援、故障反馈和 AI 数据流均可在设置中访问 |

## 3. 原生应用包验收

| 项目 | 证据/结果 |
|---|---|
| sidecar 自包含 | 官方 Node runtime 的 Mach-O 仅依赖系统框架/库；不依赖 Homebrew `libuv` |
| 随机端口 | 两次启动分别使用不同回环端口；健康检查均返回 `integrity: ok` |
| 持久化 | 原生实例写入“桌面壳退出前已可靠落盘。”，退出重启后逐字一致且版本存在 |
| 系统数据目录 | 主库和启动快照写入 `com.bibudai.writer` 应用数据目录 |
| 生命周期 | 最终退出后桌面进程、sidecar 和监听端口均无残留 |
| 应用签名结构 | `codesign --verify --deep --strict` 通过；当前为 ad-hoc 身份 `-` |
| entitlement | sidecar 包含 `allow-jit`、`allow-unsigned-executable-memory`，V8/SQLite 正常启动 |
| DMG | 约 42 MB；`hdiutil verify` CRC 校验通过 |
| `.app` | 约 132 MB；当前为 arm64 架构 |

## 4. 构建中发现并修复的问题

1. Homebrew Node 动态依赖本机 `libuv`，进入 Hardened Runtime 后因签名身份不同被拒绝。改为下载并校验 Node 官方独立运行时；
2. Tauri 资源 glob 在 macOS 包中落入 `_up_/dist`。运行时兼容直接 `dist` 和实际 `_up_/dist`；
3. 丢弃 shell 事件接收器会削弱 sidecar 诊断；现持续消费 stdout/stderr，日志不含正文；
4. 原生 `window.confirm` 会阻塞浏览器自动化且可访问性较差，改为页面内两阶段确认；
5. 首次 DMG Finder 布局脚本瞬时失败；带 verbose 复跑成功，最终 DMG 单独执行完整性校验通过，失败遗留的可写临时镜像已删除。

## 5. 仍未通过的公开发布门禁

1. Developer ID 正式签名、Apple 公证和签名证书托管；
2. 自动更新公私钥、更新服务器、升级失败回滚演练；
3. Windows 11 sidecar/安装包、Credential Manager 与卸载升级；
4. Windows 微软拼音/搜狗、两个 macOS 大版本系统拼音及 100%–200% 缩放真机矩阵；
5. Intel macOS 或 Universal Binary 构建与测试；
6. 50 万字规则检查后台化、进度和取消；
7. 20 位种子作者四周持续使用、规则 precision、证据定位率和付费意愿。

因此 RC1 可以进入本机 Apple Silicon 内部使用和产品 dogfood，但不能作为面向公众的正式安装包发布。

## 6. 复验命令

```bash
npm run check
npm audit --audit-level=high
npm run release:materials
npm run desktop:build
codesign --verify --deep --strict --verbose=2 "src-tauri/target/release/bundle/macos/笔不怠.app"
hdiutil verify "src-tauri/target/release/bundle/dmg/笔不怠_0.2.0_aarch64.dmg"
```

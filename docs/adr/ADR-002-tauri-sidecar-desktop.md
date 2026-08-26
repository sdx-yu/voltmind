# ADR-002：Tauri 2 + 自包含 Node sidecar 桌面交付

- 日期：2026-08-26
- 状态：接受，RC1

## 背景

MVP 已验证 React、Tiptap、Node 24 `node:sqlite` 与本地 HTTP 会话，但仍依赖开发机 Node 环境，不能形成桌面安装包。直接把成熟数据层一次性改写成 Rust 会扩大稿件可靠性风险。

## 决定

- Tauri 2 管理原生窗口、应用数据目录和进程生命周期；
- Node 24 Single Executable Application 将服务端及依赖打成 sidecar，终端用户无需安装 Node；
- sidecar 使用 Node 官方发行包并按官方 `SHASUMS256.txt` 校验，避免 Homebrew 动态库和签名身份耦合；macOS 签名显式声明 V8 JIT 所需 entitlement；
- Tauri 启动时选择随机回环端口，把数据目录和静态资源目录通过环境变量传给 sidecar；
- WebView 只导航到该随机回环地址，继续复用 HttpOnly、SameSite=Strict 会话模型；
- RC1 仅生成当前 macOS 架构构建物。Windows sidecar 和凭据库必须在 Windows CI/真机生成并验收。

## 后果与回滚

- 优点：保留已验收数据路径、离线能力和恢复测试；桌面包不依赖系统 Node；端口冲突概率消除。
- 代价：应用包包含 Node runtime，体积大于纯 Rust；sidecar 与壳需保持版本一致。
- 回滚：浏览器形态仍可通过 `npm start` 运行；若 sidecar 方案阻断跨平台签名，可另建 ADR 评估 Rust 后端迁移。

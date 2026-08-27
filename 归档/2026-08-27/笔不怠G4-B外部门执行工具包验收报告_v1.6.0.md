# 笔不怠 G4-B 外部门执行工具包验收报告 v1.6.0

验收日期：2026-08-27（Asia/Singapore）

实现基线：`06732024426cd0cd89cf43ac795ba6a2e6d80d01`

阶段结论：**G4-B 外部门执行工具包工程通过；公开发布 NO-GO。**

## 一、交付结果

本阶段把 G4-A 的四项外部阻塞转换成拿到外部条件后可直接执行的命令、真机采集页和产品外研究台本：

- Node 官方运行时下载器支持 macOS arm64/x64 与 Windows x64，并在解包前核对官方 SHA-256；sidecar 构建能选择 `node` 或 `node.exe`；
- macOS 正式发布命令先硬检查完整 Xcode、Developer ID 和公证凭据，完成后复核 app/DMG 的 codesign、Gatekeeper、stapler 与哈希；
- Windows 正式发布命令先检查 x64、代码签名私钥/有效期/EKU 与 RFC 3161 时间戳，再生成 NSIS/MSI 并复核 Authenticode；
- Windows PowerShell 真机矩阵覆盖安装、卸载、微软拼音、搜狗拼音与强退恢复；
- `/mobile-acceptance.html` 采集不含正文的真机证据，汇总器要求 360/390/430px、iOS Safari、Android Chrome 与五项闭环；
- 《种子作者波次启动包》完成招募、同意、安全交付、支持、删除、停机和 2/4 周执行节奏；没有发送邀请或创建虚构作者。

最终机器证据：

- [公开发布七门证据](笔不怠G4-B公开发布门证据_v1.6.0.json)
- [macOS 正式分发前检](笔不怠G4-B-macOS正式分发前检_v1.6.0.json)
- [Windows 正式分发前检](笔不怠G4-B-Windows正式分发前检_v1.6.0.json)
- [移动真机矩阵前检](笔不怠G4-B移动真机矩阵前检_v1.6.0.json)

## 二、自动化与构建证据

| 检查 | 结果 |
|---|---|
| 脚本语法 | 8 个新增/修改 ESM 发布脚本经 `node --check` 通过 |
| 专项测试 | runtime、移动矩阵与发布门 3 文件 7 项通过；覆盖 Windows ZIP/node.exe、平台拒绝、真机正反例与七门决策 |
| TypeScript | app/server 两套 `tsc --noEmit` 通过 |
| 全量自动化 | 39 个测试文件、139 项测试全部通过，0 失败；总时长 440.18 秒 |
| 生产 Web 构建 | Vite 2,155 模块通过；`mobile-acceptance.html` 与更新后的 `sw.js` 均进入 `dist` |
| Node SEA sidecar | 重新生成成功；产物为 arm64 Mach-O；桌面包内 sidecar 严格签名结构通过 |
| Tauri 桌面构建 | release profile 完成，生成 `.app` 与 1.6.0 DMG；移动验收页进入 app resources |
| macOS 本机实查 | `codesign --verify --deep --strict`、JIT entitlement、`hdiutil verify` 全部通过 |
| 供应链 | CycloneDX 1.6、第三方许可证和 33 项发行制品哈希全部复算通过 |
| 生产依赖审计 | `npm audit --omit=dev --audit-level=high`：0 漏洞 |

## 三、发布物料哈希

- 1.6.0 app ZIP：`340db504cac02b8cf39e1c4f56c4e54c863c4d879e6d8d02b9d3af37a36d9466`
- 1.6.0 DMG：`23865bb56864f7d806f79e7ca752b463dbd8f133e35278f82e5a869716a95426`
- CycloneDX 1.6 SBOM：`11565f15c082da517cbd70a33230f519d0c13ec4ce515e1018e6292abdb72375`
- 第三方许可证：`e7506b0d95678d88b8c548de0d86fe2680336cbf5c2632adfa9985e819214709`

## 四、真实前检结果

| 门 | 状态 | 当前证据 |
|---|---|---|
| G4-SOURCE | PASS | 四处版本为 1.6.0；执行基线提交时无受跟踪改动 |
| G4-MATERIALS | PASS | SBOM、许可证、app ZIP/DMG 与完整 SHA-256 清单一致 |
| G4-MAC-BUILD | PASS | app 严格签名结构、DMG 完整性及资源封装通过 |
| G4-MAC-DISTRIBUTION | BLOCKED | 当前主机只有 Command Line Tools；无 Developer ID 身份和公证凭据 |
| G4-WINDOWS | BLOCKED | 当前是 macOS arm64；没有 Windows x64 证书、时间戳、安装/卸载/IME/恢复结果 |
| G4-MOBILE | BLOCKED | 汇总器按预期拒绝 0 份输入，明确缺三档真机视口、iOS Safari 和 Android Chrome |
| R1-SEED | BLOCKED | 工具与启动台本已就绪，但真实作者、同意、任务和 2/4 周时间证据不存在 |

发布门 JSON 仍返回 `NO-GO`。macOS/Windows 前检分别以退出码 2 返回 `BLOCKED`，移动汇总以退出码 1 返回 `FAILED`；这些是缺失外部证据时的正确门禁行为，不是工程成功的替代说法。

## 五、真实性与隐私边界

执行器不输出 Apple 密码、API Key、证书私钥或恢复短语；真机证据不含正文，只允许环境布尔值、Git SHA 与脱敏截图引用；作者波次台本明确把身份/联系方式保存在产品外受控系统。任何 JSON 均需发布或研究负责人核对来源主机、设备、制品哈希和外部记录后才可能提升门状态。

Windows 的实际编译/签名和 PowerShell 矩阵未在 macOS 上伪执行；移动页面进入桌面包不等于手机真机通过；招募文案完成不等于邀请已发送或真实周期已发生。

## 六、验收结论

原始调研路线中仍可由工程完成的发布执行缺口已收口：正式平台构建、签名、公证、真机证据采集、汇总门禁、作者启动与发行物料都有固定入口、失败边界和归档。现有产品代码无需再为这四门追加功能。

剩余工作只能在外部条件真实到位后执行：授权的 Apple 身份与完整 Xcode、Windows x64 签名主机、三档移动真机以及真实作者和自然时间。当前公开发布与 R1 继续 NO-GO，不以工程工具包完成冒充外部验证完成。

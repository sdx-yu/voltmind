# G4-A 公开发布门预检（1.6.0）

状态：本机发布门预检能力与工程证据通过；公开发布保持 NO-GO。

R1-C 之后不再追加产品功能。G4-A 把 R1 中可在本机复核的发布准备项固化为机器可读证据，同时把必须依赖真实人员、证书、设备和时间的门保持为 `BLOCKED`。

## 冻结范围

1. `g4-release-readiness-v1` 输出版本、Git 提交与受跟踪改动状态；
2. 校验 CycloneDX 1.6 SBOM、第三方许可证、当前 DMG SHA-256 与 `release/SHA256SUMS`；
3. 分开验证 macOS 签名结构、Developer ID、DMG、Gatekeeper 与公证票据，不把 ad-hoc 签名解释为正式分发通过；
4. 显式列出 Windows x64 签名安装/卸载/中文输入法/恢复矩阵、移动真机矩阵和真实种子作者门；
5. 输出仅含发布状态和固定门定义，不含作者身份、联系方式、正文或凭据；
6. 系统命令有 15 秒上限；集成测试有 60 秒有限上限，以适配资源受限桌面/CI，同时保留真正挂起的失败能力。

## 七项发布门

| 门 | 证据类型 | 通过条件 |
|---|---|---|
| G4-SOURCE | 本机工程 | 四处版本一致，受跟踪源码无改动 |
| G4-MATERIALS | 本机工程 | SBOM、许可证与当前安装包哈希可验证 |
| G4-MAC-BUILD | 本机工程 | `.app` 严格签名结构与 DMG 校验通过 |
| G4-MAC-DISTRIBUTION | 外部 | Developer ID、Gatekeeper 与公证票据通过 |
| G4-WINDOWS | 外部 | Windows x64 签名包及安装/卸载/IME/恢复真机矩阵通过 |
| G4-MOBILE | 外部 | 360/390/430px 真实设备、离线/弱网/PWA 更新/加密接力通过 |
| R1-SEED | 外部 | 至少 5 名两周、3 名四周真实作者证据通过人工复核 |

只有七门全部 `PASS` 才返回 `GO`。夹具、工程演练、存在但未验签的 Windows 文件、ad-hoc 签名和 Gatekeeper 单项结果都不能替代对应外部证据。

## 验收方法

- 决策单元测试同时覆盖“本机三门通过、外部四门阻塞”和“七门全通过才 GO”；
- `npm run typecheck`、37 文件 134 项自动化、2,155 模块生产构建；
- 重新生成 SBOM/许可证并执行生产依赖审计；
- 对 1.6.0 `.app` 与 DMG 执行 codesign、hdiutil、spctl、stapler 和 SHA-256 实查；
- 从干净 Git 提交生成最终 JSON，再把 JSON、报告与 SHA-256 写入日期归档。

## 终止边界

G4-A 只证明发布预检可复跑和本机证据状态真实，不证明公开发布通过。没有 Developer ID/公证、Windows 真机、移动真机和真实作者周期时，R1 与 `releaseDecision` 必须保持 NO-GO。

# 需求追踪矩阵

基线：产品定义与 MVP 规格 v1.0。状态分为 `通过`、`工程通过/待外部矩阵`、`外部验证`。

| 需求 | 状态 | 实现位置 | 自动化/验收证据 |
|---|---|---|---|
| FR-001 本地项目 | 通过 | `server/db.ts`、`Bookshelf.tsx`、WAL/FULL | 浏览器无账号创建、重载重开、900ms 自动保存；API 会话重启自动恢复 |
| FR-002 书稿树 | 通过 | `ManuscriptTree.tsx`、节点 API | 书/卷/章/场景 CRUD、拖动与 Alt+方向键排序、原子拆分/合并、递归回收；数据库递归恢复测试 |
| FR-003 长篇编辑 | 工程通过/待外部矩阵 | `WritingEditor.tsx`、Tiptap | 20 万汉字数据库负载；真实编辑器 20 万字符写入并保存；系统拼音与 Windows 输入法矩阵仍需真机执行 |
| FR-004 自动保存与快照 | 通过 | `WritingEditor.tsx`、`revisions` | 900ms 防抖保存、不可变版本、Diff 预览、恢复为新版本；版本测试 |
| FR-005 全局搜索替换 | 通过 | `SearchModal.tsx`、`replace_batches` | 正文/标题/正典范围、命中预览、事务提交和整批撤销；数据库与浏览器闭环 |
| FR-006 导入 | 通过 | `Bookshelf.tsx`、`/api/import`、`imported_sources` | TXT/MD/DOCX 解码、章节预览、原件哈希留存、单事务建项目；坏哈希不产生项目测试 |
| FR-007 导出 | 通过 | `DeliveryWorkspace.tsx`、导出 API | TXT/MD/DOCX、范围与模板；DOCX 用 Mammoth 重新读取验证标题/正文 |
| FR-008 备份还原 | 通过 | `bbd-backup-v2`、`backups.ts` | 正文/正典/版本/Mention/候选/来源/设置；SHA-256 阻断篡改；临时新数据库恢复测试；20+7 轮换测试 |
| FR-009 基础正典 | 通过 | `CanonWorkspace.tsx`、实体 API | 四类实体增改、搜索、别名、软删除、正文反链；浏览器闭环 |
| FR-010 时态状态 | 通过 | `entity_states`、`current-states` | 半开区间重叠约束、故事/叙述位置投影、当前场景状态显示；区间测试 |
| FR-011 Mention | 通过 | Mention API、`WritingEditor.tsx` | 自动建议、人工确认、点击定位、按引用最近位置修复锚点；修复测试与浏览器闭环 |
| FR-012 事实候选 | 通过 | `candidate_changes`、`canon_events` | evidence/before/after/effective node；接受、修改后接受、忽略；事务与哈希事件链测试 |
| FR-013 一致性检查 | 通过 | `continuity.ts` | 专名、死亡状态、持有关系、ISO 故事时间；双证据、置信度、持久例外；规则测试 |
| FR-014 AI Provider | 工程通过/待外部矩阵 | `ai.ts`、`vault.ts` | OpenAI-compatible 配置/测试；生产 macOS 系统钥匙串、AES-GCM 密文；明文不返回/不入库测试。Windows 凭据库待桌面壳 |
| FR-015 上下文胶囊 | 通过 | `AiPanel`、`buildContext` | 执行前查看、勾选增删、原因、隐私、token 估算；`local_private` 服务端二次过滤；浏览器实测 |
| FR-016 AI Diff | 通过 | `DiffText`、编辑器事件 | 改写原文/候选 Diff、句级勾选、拒绝、部分接受、撤销；浏览器实测并验证来源版本 |
| FR-017 写作目标 | 通过 | `writingStats`、设置/交付台 | 日/项目目标；当前正文减日初基线计算净新增，粘贴和撤销不重复累计 |
| FR-018 专注与显示 | 通过 | `WritingEditor`、`display.ts` | 专注进入/退出布局恢复；字号/纸宽按设备 localStorage 保存；浏览器实测 |
| FR-019 回收站 | 通过 | 项目/节点/实体软删除 API、回收站 UI | 项目、卷、章、场景、实体；恢复原位或选择合法新父级；递归恢复测试 |
| FR-020 来源记录 | 通过 | `revisions`、`operation_log`、`ai_tasks` | 人写、AI 建议与接受、恢复、导入、替换均留痕；日志只存哈希/ID，不存 Key、Prompt 或正文 |
| 商业 H1–H5 | 外部验证 | 种子用户计划 | 必须由真实作者四周使用验证，不能由工程测试替代 |

完整证据与限制见归档中的《MVP 实施与验收报告 v1.0》。

## RC1 发布门禁追踪

| 门禁 | 状态 | 证据 |
|---|---|---|
| macOS 原生桌面壳 | 通过（Apple Silicon） | Tauri 2 `.app`/DMG；自包含 Node SEA sidecar；随机回环端口与系统数据目录实机冒烟 |
| 损坏库救援 | 通过 | `rescue.ts`、`RescueScreen.tsx`；故障注入、快照校验、路径穿越阻断、原件隔离、浏览器两阶段恢复闭环 |
| 发布物料 | 通过 | CycloneDX 1.6 SBOM、177 个运行时包许可证清单、0 个已知 npm 漏洞；JSZip 采用双许可证中的 MIT |
| 签名与镜像完整性 | 工程通过/待正式身份 | `codesign --verify --deep --strict`、V8 JIT entitlement、`hdiutil verify` 通过；当前仅 ad-hoc 签名，未公证 |
| Windows 桌面与凭据库 | 待外部矩阵 | Windows sidecar/安装包、Credential Manager、微软拼音/搜狗未执行 |
| 输入法与缩放矩阵 | 待外部矩阵 | 仍需两个 macOS 大版本及 Windows 11 真机 100%–200% 矩阵 |
| 50 万字检查取消 | 待实现 | 当前规则检查仍为同步快速任务；发布前需后台化和可取消 |
| 种子作者验证 | 外部验证 | 20 位作者四周留存、正典闭环使用率和付费意愿尚未开始 |

## V1-D 交付体验层追踪

| 能力 | 状态 | 实现位置 | 自动化/验收证据 |
|---|---|---|---|
| 系统本地朗读 | 通过 | `ReadAloudPanel.tsx`、Web Speech/Tauri WebView 系统声音 | 当前选区/场景/章节范围、声音、语速、播放/暂停/继续/停止、句级位置；组件测试与真实系统声音浏览器闭环 |
| 版本化渠道模板 | 通过 | migration v6、`delivery_templates`、`delivery_rules` | 通用模板与经官方来源核验的番茄模板；版本、核验日期、来源说明和过期阈值可见 |
| 可解释交付检查 | 通过 | `server/delivery.ts`、`DeliveryWorkspace.tsx` | 规则编号、严重度、命中文本和原文偏移；单项关闭后重新检查不再报告；浏览器定位正文闭环 |
| V1-D 备份兼容 | 通过 | `bbd-backup-v2` delivery bundle | 朗读偏好、规则覆盖、检查记录恢复；节点与章节引用重映射；迁移前自动备份和 API 恢复测试 |
| 平台真实投稿 | 外部验证 | 不在本地产品内模拟 | 未使用平台账号自动投稿，也不宣称检查结果保证过审 |

## V1-E 来源证明层追踪

| 能力 | 状态 | 实现位置 | 自动化/验收证据 |
|---|---|---|---|
| 来源事件链 | 通过 | migration v7、`provenance_events`、`server/db.ts` | 人工、AI 生成/接受/拒绝/撤销、AI 后人工修订、导入、恢复、合并、替换与事实候选；旧版本兼容投影与 v6→v7 迁移测试 |
| 场景与项目回放 | 通过 | `Inspector.tsx`、`ProvenanceWorkspace.tsx` | 来源筛选、父版本 Diff、哈希、场景定位；组件测试与真实浏览器主链 |
| 可验证导出 | 通过 | `server/provenance.ts`、`bbd-provenance-v1` | JSON/HTML、自校验、篡改失败；默认无正文，显式摘录上限 500 字，Prompt/密钥/AI 输出全文排除测试 |
| 来源链备份恢复 | 通过 | `bbd-backup-v2` provenance/aiTasks bundle | 节点、版本、任务 ID 重映射；恢复前链校验；恢复后事件哈希、AI 来源关系和链头不变测试 |
| 法律或平台认证 | 外部验证 | 产品明确免责声明 | 不宣称版权确权、司法效力、可信时间戳或平台原创认证 |

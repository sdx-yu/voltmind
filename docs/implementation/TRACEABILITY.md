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

## V1-S 加密同步工程追踪

| 能力 | 状态 | 实现位置 | 自动化/验收证据 |
|---|---|---|---|
| 协议与端到端加密 | 本机工程通过 | migration v8、`server/sync.ts`、`SYNC_PROTOCOL_V1.md` | 192 bit 短语、scrypt、AES-256-GCM/AAD、分块与整包哈希；明文不可见、错误短语和篡改阻断测试 |
| 离线正文收敛 | 本机工程通过 | Yjs `Y.Text` 状态、版本向量 | 两个隔离 SQLite 副本并发编辑、反向导入、重复包后正文确定性相同；内存五项演练通过 |
| 结构化业务冲突 | 通过 | `sync_object_versions`、`sync_conflicts`、`SyncWorkspace.tsx` | 正典并发、删除/编辑进入显式冲突；本机/接力包决策写入来源事件 |
| 来源链分叉 | 通过 | `provenance_fork`、同步来源事件 | 严格前缀追加；并发链不静默改写，只能保留本机或知悉远端分叉 |
| 附件内容寻址 | 通过 | `sha256:<digest>` 附件载荷 | 导出与落库前复核字节数和 SHA-256；同哈希幂等去重与新设备恢复测试 |
| 丢失设备与密钥恢复 | 本机工程通过 | 书架“接力恢复”、一次性短语 | 新空库恢复为新 device ID；短语不二次显示、不入普通备份；所有设备和短语同时丢失不可恢复 |
| 可见工作流 | 通过 | 交付台入口、`SyncWorkspace.tsx`、Bookshelf | 真实浏览器初始化、一次性提示、五项演练、390px 窄屏与零控制台告警 |
| 真实云端与双设备 | 外部验证 | 未来中继最小契约 | 未部署账号/中继；未执行两台真实设备断网、睡眠、升级、删除 SLA 和安全审计 |

## V1-M 移动收集与审阅追踪

| 能力 | 状态 | 实现位置 | 自动化/验收证据 |
|---|---|---|---|
| 可安装离线 PWA | 本机工程通过 | `manifest.webmanifest`、`sw.js`、`pwa.ts` | 首装原子缓存入口与哈希资源；用户确认更新；保留上一 shell；生产构建断服后重开成功 |
| 离线收集箱 | 通过 | `mobileStore.ts`、migration v9、移动 API | IndexedDB 先写后回流；20 条关闭重开保留；低配额与缓存异常不假报成功 |
| 不可变事件并集 | 通过 | `mobile_inbox_items`、`mobile_inbox_actions` | ID 相同载荷幂等、异载荷拒绝；乱序动作按时间与 ID 确定性折叠；API 重放测试 |
| 移动只读审阅 | 通过 | `MobileHome.tsx`、`/api/mobile/library` | 来源标签、版本时间、正文只读、关联场景审阅笔记与显式认可；390px 浏览器闭环 |
| 加密接力互通 | 本机工程通过 | `bbd-sync-v1` 可选 `mobileInbox` | 已归属和未归类事件在隔离 SQLite 副本并集；重复包幂等；0.8 无字段载荷保持兼容 |
| 普通备份恢复 | 通过 | `bbd-backup-v2` 可选 `mobileInbox` | 项目记录、动作和目标场景重映射；校验和覆盖；同步身份仍排除 |
| 窄屏与桌面回归 | 通过 | 移动三段首页、桌面四工作台 | 360/390/430px 无横向溢出，主操作 ≥44px，控制台 0 错误；桌面书架和写作台通过 |
| 真机、部署与商店 | 外部验证 | 外部门 | 未提供手机可访问的 HTTPS/LAN/云入口；iOS/Android 安装、键盘、系统回收与商店签名未执行 |

## V2-R 角色化审阅接力追踪

| 能力 | 状态 | 实现位置 | 自动化/验收证据 |
|---|---|---|---|
| 三角色最小授权 | 通过 | migration v10、`ReviewService`、`ReviewWorkspace.tsx` | Beta Reader 仅评论；Editor/Co-Writer 可提交局部建议；场景白名单与角色在服务端复核，越权测试通过 |
| 双向加密审阅包 | 通过 | `server/review.ts`、`bbd-review-v1` | 192 bit 短语、scrypt、AES-256-GCM/AAD、加盐项目指纹；明文不可见、错误短语、篡改、跨项目与过期阻断 |
| 隔离审阅副本 | 通过 | 书架“打开审阅任务”、`projectId=null` received session | 全新空库直接导入任务，不创建作者项目；只含 1–100 个授权场景，正文载荷上限 5 MiB |
| 段落锚点三态 | 通过 | `createReviewAnchor`、`resolveReviewAnchor` | 段落哈希、引用、前后文与偏移；exact/candidate/lost 及多空行全局偏移测试通过，失效建议不自动应用 |
| 作者逐条决定 | 通过 | 作者审阅台、review decisions、来源事件 | 原文—建议 Diff、定位、采纳/拒绝/暂缓；采纳建议生成新版本与 `review_suggestion_accepted`，双端真实浏览器闭环 |
| 幂等与碰撞阻断 | 通过 | feedback 不可变 ID、会话/包校验 | 重复回应不重复建意见；同 ID 异载荷、重复载荷 ID、元数据提升与范围扩大均阻断 |
| 普通备份互操作 | 通过 | `bbd-backup-v2` 可选 `review` | 会话/意见/决定恢复为 `restored/archived`；恢复短语、盐、校验值与项目指纹排除测试 |
| 桌面与既有能力回归 | 通过 | 1.0.0 `.app`/DMG、全量测试 | 81 项测试、构建、严格签名、JIT entitlement、DMG 校验与启动冒烟通过；0 个 production npm 漏洞 |
| 账号、在线邀请与实时合著 | 外部验证 | 外部门 | 未提供认证身份、在线撤销、组织成员生命周期、云通知或多人光标，不宣称已实现 |

## V2-F 安静冲刺与小组目标追踪

| 能力 | 状态 | 实现位置 | 自动化/验收证据 |
|---|---|---|---|
| 版本差净新增 | 通过 | migration v11、`SprintService`、冲刺快照 | 粘贴只计一次；撤销/删除抵消；场景/项目范围按开始与结束已保存版本差计算 |
| 可信计时与暂停 | 通过 | `sprint_sessions`、不可变 samples/events | 10–120 分钟、暂停/恢复、提前结束；墙钟与累计暂停计算，不依赖单一 interval |
| 睡眠/时钟故障 | 通过 | `reconcile`、`sleep_detected`、`clock_anomaly` | 页面离开/睡眠按最后可见时间保守暂停；时钟回拨暂停；故障注入测试通过 |
| 安静写作 HUD | 通过 | `SprintWorkspace.tsx`、`WritingEditor` flush | 剩余时间、实时净新增、目标、暂停、恢复、结束；不阻断自动保存、撤销和紧急退出 |
| 无正文成果卡 | 通过 | `bbd-sprint-v1`、`SPRINT_PROTOCOL_V1.md` | 事件链、链头、整卡哈希、严格 Schema；包内无书名、正文、项目/场景 ID或设备 ID |
| 离线小组看板 | 通过 | `sprint_boards`、`sprint_board_cards` | 日/周目标、参与者汇总；同卡幂等、同 ID 异载荷阻断、周期越界阻断 |
| 普通备份与移动只读 | 通过 | `bbd-backup-v2` sprint bundle、`MobileHome` | 冲刺历史与看板恢复；移动端只读最近结果并明确“仅结果，不含正文” |
| 可访问性与提醒 | 本机工程通过 | 原生控件、`prefers-reduced-motion`、Notification | 键盘可达、减弱动画；通知需显式授权且到时不自动提交正文 |
| 桌面与既有能力回归 | 通过 | 1.1.0 `.app`/DMG、全量测试 | 89 项测试、真实浏览器、生产构建、严格签名、JIT entitlement、DMG 校验与启动冒烟通过；0 个 production npm 漏洞 |
| 在线房间与认证身份 | 外部验证 | 外部门 | 未提供 presence、聊天室、排行榜认证、防作弊、好友关系或云通知 SLA |

## V2-P 本地插件与结构模板包追踪

| 能力 | 状态 | 实现位置 | 自动化/验收证据 |
|---|---|---|---|
| 内容寻址本地包 | 通过 | migration v12、`TemplateService`、`bbd-template-v1` | 严格 Schema、512 KiB/100 节点/20 规则上限、结构/整包 SHA-256；篡改、未知字段与 ID 碰撞阻断 |
| 声明式结构与规则 | 通过 | `server/template.ts`、`TEMPLATE_PROTOCOL_V1.md` | 只允许空白章/场景、计数与重复标题规则；不解析/执行 JS、Wasm、Node 或系统命令 |
| 逐项最小授权 | 通过 | `template_grants`、`TemplateWorkspace.tsx` | 安装后默认零权限；摘要/创建/规则按项目单独授权；正文、网络、密钥、文件和命令无可授权入口 |
| 预览与冲突 | 通过 | `TemplatePreview`、书稿树指纹 | 显示待建节点/状态/空正文/规则结果；旧预览失效；同名章需显式后缀改名，不覆盖现有节点 |
| 单事务应用 | 通过 | `template_applications`、SQLite `BEGIN IMMEDIATE` | 故障注入在第二个节点失败，第一个节点与应用记录一同回滚；成功应用 3 章/8 场 |
| 整批撤销与来源 | 通过 | 回收站、`template_applied/reverted` | 整批软删除且可恢复；应用/撤销来源事件可见；停用/卸载不删历史 |
| 普通备份恢复 | 通过 | `bbd-backup-v2` templates bundle | 相关包、授权、应用记录和节点引用重映射；不含正文或密钥 |
| 桌面与既有能力回归 | 通过 | 1.2.0 `.app`/DMG、全量测试 | 99 项测试、真实浏览器、生产构建、严格签名校验、JIT entitlement、DMG 校验与启动冒烟通过；0 个 production npm 漏洞 |
| 在线市场与发布者身份 | 外部验证 | 外部门 | 未提供账号、数字签名、恶意包扫描、审核/下架、评分、下载量、付费或版权投诉 |

## V2-V 文字正典驱动的视觉锚点与故事板追踪

| 能力 | 状态 | 实现位置 | 自动化/验收证据 |
|---|---|---|---|
| 显式正典字段快照 | 通过 | `VisualService.prepareCanon`、`VisualWorkspace` | 正典名称必选，简介/别名/状态逐项选择；未选字段不进描述；`local_private` 服务端拒绝 |
| 正典版本绑定 | 通过 | `VisualCanonSnapshot`、规范化 `canonHash` | 哈希只覆盖类型、已选字段和值；未选字段变化不失效，已选字段变化显示 stale；刷新不自动升级旧图 |
| 内容寻址图片 | 通过 | migration v13、`visual_assets` | PNG/JPEG 魔数、服务端尺寸、10 MiB/像素上限、原始字节 SHA-256、重复幂等、MIME 欺骗与碰撞阻断 |
| 候选—接受/拒绝 | 通过 | `visual_candidates`、候选决定 API | 导入默认 pending；接受前重验正典；接受不写正典；旧定稿 superseded；拒绝与来源留痕 |
| 无正文故事板 | 通过 | `storyboards`、`storyboard_cards` | 场景卡仅含镜头目的、备注、锚点、资产和正典哈希；重排/删除不改正文、正典或资产 |
| 普通备份与来源 | 通过 | `bbd-backup-v2` visual bundle、视觉/来源事件 | 原始字节、锚点、候选、分镜、决定恢复并重映射；恢复复验哈希/MIME/尺寸/正典 |
| 可见工作流与无障碍 | 通过 | `VisualWorkspace.tsx`、响应式 CSS | 键盘可达字段选择、文件导入、候选决定、过期提示、场景选择、分镜建立/重排/删除 |
| 桌面与既有能力回归 | 通过 | 1.3.0 `.app`/DMG、全量测试 | 108 项测试、真实浏览器、生产构建、严格签名校验、JIT entitlement、DMG 校验与 sidecar 健康冒烟通过；0 个 production npm 漏洞 |
| 远程生成、版权与跨图一致性 | 外部验证 | 外部门 | 1.3.0 不连接图像 Provider；未声称版权审核、真人身份、供应商保留政策或角色跨图一致性通过 |

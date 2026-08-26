# 笔不怠数据与 AI 设计

| 字段 | 内容 |
|---|---|
| 文档版本 | v1.0 |
| 归档日期 | 2026-08-26 |
| 状态 | Architecture Baseline |
| 关联文档 | [产品定义与 MVP 规格](笔不怠产品定义与MVP规格_v1.0.md) · [里程碑与验收计划](笔不怠里程碑与验收计划_v1.0.md) |

## 1. 设计目标

数据架构必须同时满足四类需求：

1. 正文输入足够轻、快、稳；
2. 故事事实能随故事时间变化；
3. AI 只能看到任务所需且作者允许的上下文；
4. 任何自动修改都能解释、确认、撤销和审计。

不把“向量数据库 + 聊天框”称为故事记忆。向量召回只能是检索手段之一，不能代替正典、时间、因果和权限。

## 2. 总体架构

```text
┌──────────────────── 桌面客户端 ────────────────────┐
│ React / TypeScript                                 │
│                                                    │
│  写作台     正典库      剧情台      交付台          │
│     │          │           │           │           │
│  Tiptap   Canon Service  Graph View  Exporter      │
│     └──────────┬───────────┴───────────┘           │
│                │ Application Service               │
│       ┌────────┴────────┐                           │
│       │ SQLite + FTS5  │ ← Operation Log / Snapshot│
│       └────────┬────────┘                           │
│                │                                   │
│  Context Builder → Rule Engine → AI Provider       │
│                │                │                   │
│         Candidate Change ← Structured Result       │
└────────────────┼────────────────┼───────────────────┘
                 │可选同步         │用户允许时
          加密更新流/附件          云模型或本地模型
                 │
          Sync API + Object Store（V1）
```

### 2.1 进程边界

- UI 渲染进程不得直接持有 API Key；
- 文件、数据库、凭据、备份和迁移由受控本地核心提供；
- AI 请求通过 Provider Adapter 发出，调用前由 Privacy Filter 再检查一次字段；
- 导入、索引、长检查、AI 抽取在后台任务运行，可取消、可恢复；
- 核心编辑和保存不能依赖后台任务是否健康。

## 3. 项目包与存储

### 3.1 项目包建议

项目默认表现为一个可移动目录，后续可打成单文件备份：

```text
project-name.bbd/
├── manifest.json          # 格式版本、项目 ID、校验信息
├── content.db             # SQLite 权威数据
├── attachments/           # 以 SHA-256 内容哈希命名
├── exports/               # 可选；不纳入权威数据
├── snapshots/             # 数据库与正文快照
└── recovery/              # 崩溃恢复日志
```

`.bbd` 是工作名，正式发布前需确认扩展名冲突和品牌。作者可在设置中选择是否把导出文件放在项目包内。

### 3.2 权威数据与派生数据

| 数据 | 是否权威 | 是否可重建 |
|---|---:|---:|
| 场景 Tiptap JSON | 是 | 否 |
| 正典实体、状态、事件 | 是 | 否 |
| Revision / Canon Event | 是 | 否 |
| Mention 人工确认结果 | 是 | 部分 |
| FTS 索引 | 否 | 是 |
| 向量 embedding | 否 | 是 |
| AI 上下文缓存 | 否 | 是 |
| 导出文件 | 否 | 是 |
| 缩略图、预览 HTML | 否 | 是 |

任何备份恢复都以权威数据为完成标准；派生索引缺失时后台重建，不阻塞打开正文。

### 3.3 标识与顺序

- 所有对象使用不可变 UUID/ULID，不用标题、章号或数组位置作主键；
- 章与场景顺序使用可重排 `sort_key`，拖动不改对象 ID；
- 显示章号由当前位置派生，避免重排导致大量外键更新；
- 文本锚点同时保存逻辑位置、前后文指纹和修订号，以便正文变化后修复。

## 4. 核心数据模型

### 4.1 内容层

```text
Project
  └─ Book
      └─ Volume?
          └─ Chapter
              └─ Scene
                  └─ SceneRevision
```

关键字段：

```text
Project(id, title, language, format_version, created_at, updated_at)
Book(id, project_id, title, sort_key)
Volume(id, book_id, title, sort_key, nullable)
Chapter(id, parent_id, title, sort_key, status, published_revision_id)
Scene(id, chapter_id, title, sort_key, pov_entity_id, status, story_time_hint)
SceneRevision(id, scene_id, parent_revision_id, content_json, content_hash,
              source_type, created_at, actor_id)
```

`source_type`：`human`、`import`、`ai_accepted`、`restore`、`merge`。来源只描述该修订如何产生，不武断计算某句话的著作权归属。

### 4.2 正典层

```text
Entity(id, project_id, type, canonical_name, summary, privacy_level, status)
EntityAlias(id, entity_id, alias, valid_scope, normalized_alias)
AttributeDefinition(id, entity_type, key, value_type, cardinality)
EntityFact(id, entity_id, attribute_key, value_json, confidence, source)
EntityState(id, entity_id, attribute_key, value_json,
            valid_from_event_id, valid_to_event_id, world_time_from, world_time_to)
Relation(id, subject_id, predicate, object_id, state_id)
Event(id, project_id, name, world_time, duration, location_id, status)
EventParticipant(event_id, entity_id, role)
EventEdge(from_event_id, to_event_id, type, confidence)
```

MVP `Entity.type`：character、location、item、event。organization 和 rule 可在 schema 中预留，界面延后开放。

### 4.3 三种“时间”必须分开

| 时间 | 含义 | 示例 |
|---|---|---|
| 叙述位置 | 读者在第几章/场景读到 | 第 39 章第 2 场 |
| 故事时间 | 故事世界中何时发生 | 景和十二年八月初三夜 |
| 记录时间 | 作者何时录入或系统何时确认 | 2026-08-26 21:14 |

不能用章号直接代替故事时间。倒叙、插叙、预言和多线并行时，叙述位置与故事时间不同。

### 4.4 信息可见性

事实至少具有以下可见范围：

- `world_truth`：世界真实状态；
- `reader_known_from_scene`：读者从何场景开始知道；
- `pov_known`（V1）：某角色从何事件开始知道；
- `author_only`：作者备注，默认不进入生成任务；
- `local_private`：不得发送给云端模型。

MVP 先完整实现世界真实状态与读者已知；角色知识作为 schema 预留和 V1 功能。否则第一版复杂度过高。

### 4.5 候选与审计层

```text
CandidateChange(
  id, project_id, target_type, target_id, operation,
  before_json, after_json, evidence_json,
  confidence, source_task_id, status, created_at, resolved_at
)

CanonEvent(
  id, project_id, candidate_id, event_type, payload_json,
  effective_event_id, actor_id, created_at, previous_hash, event_hash
)

OperationLog(
  id, project_id, object_type, object_id, operation,
  revision_before, revision_after, actor_type, task_id, created_at
)
```

`previous_hash + event_hash` 用于发现日志意外损坏，不对外宣称区块链或法律存证。若未来提供可信时间戳，单独设计并做合规评估。

## 5. 正典事务

### 5.1 事务规则

所有可能改变后续上下文的自动结果都必须经过：

```text
Detect → Propose → Validate → Preview → Accept → Commit → Reindex
```

1. **Detect**：规则或 AI 从已保存修订中发现变化；
2. **Propose**：生成 CandidateChange，不改权威数据；
3. **Validate**：校验对象、类型、有效区间和互斥状态；
4. **Preview**：展示 Diff、证据、置信度和影响；
5. **Accept**：用户接受、修改后接受或拒绝；
6. **Commit**：单事务写入 EntityState/Event/Mention/CanonEvent；
7. **Reindex**：事务提交后异步更新全文和向量索引。

### 5.2 原子性要求

以“物品换主人”为例，一次接受必须原子完成：

- 结束旧持有状态；
- 新建新持有状态；
- 关联发生转交的事件；
- 写入证据 Mention；
- 写入 CanonEvent；
- 更新候选状态。

任一步失败全部回滚。索引更新失败不回滚正典，但要标记待重建。

### 5.3 区间冲突处理

同一实体同一单值属性不允许在同一故事时间出现两个有效值。遇到重叠时提供三种选择：

1. 截断旧区间并接入新值；
2. 修改新值生效时间；
3. 将属性改为多值（仅定义允许多值时）。

系统不得自行选择。

## 6. Mention 与文本锚点

### 6.1 自动建议流程

1. 对已知实体名称和别名做归一化匹配；
2. 排除太短、歧义高和处于代码/注释等无效范围的候选；
3. 根据同场景其他实体、最近出场和类型计算建议分；
4. 高置信度只做视觉弱标记，仍不自动合并实体；
5. 用户确认后建立 Mention。

### 6.2 锚点修复

每个 Mention 保存：场景修订号、编辑器逻辑位置、原文、前后各若干字符指纹。正文修订后依次尝试：

1. 编辑器映射位置；
2. 同修订 diff 映射；
3. 前后文指纹唯一匹配；
4. 无法唯一定位则标记“待修复”，不悄悄指向错误文本。

## 7. AI Provider Adapter

### 7.1 能力模型

Provider 不按品牌写死，而是声明能力：

```text
ProviderCapabilities:
  chat
  structured_output
  streaming
  reasoning
  embeddings
  local
  data_retention_policy
  max_context_tokens
  pricing_input / pricing_output
```

任务按能力选模型，用户界面默认显示角色和质量档位；高级设置才展示具体模型。

### 7.2 密钥与日志

- API Key 写入系统凭据库，数据库只存引用 ID；
- 请求日志默认只存任务类型、模型、token、耗时、状态码和内容哈希；
- 调试日志不得包含 Authorization header、正文和结构化正典；
- 用户主动导出 AI 调试包时，先展示脱敏预览。

### 7.3 失败策略

- 429：显示可重试时间，不自动无限重试；
- 5xx/网络中断：指数退避最多 2 次，用户可取消；
- 流式响应中断：保留为未完成候选，不得自动插入；
- JSON 解析失败：一次结构修复；仍失败则展示原始文本供复制，不写正典；
- 模型上下文超限：回到上下文预览让用户裁剪，不静默丢弃关键事实。

## 8. 上下文构建器

### 8.1 上下文包结构

```json
{
  "task": {"type": "continue_scene", "constraints": {}},
  "scene": {"outline": "...", "current_text": "..."},
  "canon": {
    "entities": [],
    "states_as_of_story_time": [],
    "reader_known_facts": []
  },
  "history": {"recent_summaries": [], "retrieved_passages": []},
  "style": {"approved_samples": [], "negative_rules": []},
  "privacy": {"excluded_fields": []},
  "provenance": {"items": []}
}
```

每个 `provenance.items` 记录来源对象、修订号、选入原因、token 数和隐私级别。界面的上下文胶囊就是这份结构的可读投影。

### 8.2 检索顺序

按确定性和相关性从高到低：

1. 用户明确选择的场景/实体；
2. 当前场景卡绑定的 POV、人物、地点、情节线；
3. 当前故事时间有效的实体状态；
4. 读者截至上一叙述场景已知的事实；
5. 直接因果前置事件和未解决结果；
6. 最近若干场景摘要；
7. FTS/BM25 关键词检索；
8. 向量语义召回；
9. 风格样本。

向量结果不能覆盖显式正典；当两者冲突时，保留两者并生成冲突说明。

### 8.3 Token 预算

默认预算按百分比分配，可由任务模板调整：

| 区域 | 默认占比 |
|---|---:|
| 当前文本与任务 | 35% |
| 正典与当前状态 | 25% |
| 相关事件/历史 | 20% |
| 风格样本 | 10% |
| 输出余量与系统指令 | 10% |

裁剪顺序：低相关向量片段 → 较旧场景摘要 → 次要实体描述 → 风格样本。用户明确选择项、当前状态和任务约束默认不可被静默裁剪。

### 8.4 上下文可见解释

每项显示一种原因：

- `你手动选择了它`
- `当前场景人物`
- `该状态在本场景时间有效`
- `与当前事件存在前因/结果关系`
- `与选中文本语义相关`
- `用于匹配已确认文风`

这既是信任机制，也是调试工具。

## 9. AI 任务合同

### 9.1 MVP 任务

| 任务 | 输入范围 | 输出 | 是否可改正典 |
|---|---|---|---:|
| 脑暴 | 场景卡 + 选定正典 | 3–5 个方向及风险 | 否 |
| 续写 | 当前段落 + 最小上下文 | 正文候选 | 否 |
| 改写 | 选中文本 | 带 Diff 的正文候选 | 否 |
| 冷读反馈 | 当前场景/章 | 疑问、期待、困惑 | 否 |
| 连续性检查 | 场景 + 有效状态 | 问题候选与证据 | 否 |
| 事实抽取 | 完成场景 | 结构化 CandidateChange | 仅接受后 |

### 9.2 结构化输出

事实抽取必须满足 schema：

```json
{
  "changes": [{
    "subject_entity_id": "...",
    "attribute": "holder",
    "old_value": "...",
    "new_value": "...",
    "effective_event": "...",
    "evidence_quote": "...",
    "evidence_offsets": [0, 0],
    "confidence": 0.0,
    "reason": "..."
  }]
}
```

服务端不相信模型返回的 ID、offset 和 old_value，必须回查数据库与原文验证。`evidence_quote` 只用于定位，界面最终展示数据库中重新截取的证据。

### 9.3 Prompt 版本

每次任务记录：task type、prompt template version、provider、model、capability flags、context manifest hash、输出 hash、token、费用和结果状态。Prompt 更新不得使旧结果失去可追溯性。

## 10. 一致性检查引擎

### 10.1 MVP 规则

| 规则 | 首选方式 | 示例 |
|---|---|---|
| 专名不一致 | 字典 + 编辑距离 + 上下文消歧 | 林照 / 林昭 |
| 已死亡人物行动 | 时态状态 + 事件顺序 | 角色死亡后无解释再次出场 |
| 物品同时持有 | 单值区间约束 | 同一把剑同时在两人手里 |
| 地点瞬移 | 时间差 + 地点距离规则 | 同时刻跨越不可能距离 |
| 年龄/日期矛盾 | 时间运算 | 出生时间与当前年龄不符 |
| POV 泄密 | 读者/角色知识（V1） | POV 角色使用尚未知信息 |
| 伏笔未回收 | 状态机（V1） | 交付范围结束仍为 open |

### 10.2 提示结构

每个提示必须有：

- 严重度：错误风险 / 建议复核 / 风格提示；
- 简明陈述，不假装确定；
- 当前证据与冲突证据；
- 规则名称、置信度；
- 操作：修正文稿、更新正典、设为例外、忽略一次。

示例：

> 建议复核：第 39 章写“林照拔出沈砚的佩剑”，但当前正典仍记录持有者为沈砚。可能是本章发生了转交。查看两处证据 / 建立状态变化 / 忽略。

### 10.3 质量策略

- 高精度优先于高召回，避免作者被提示淹没；
- 默认只主动展示高置信度和严重问题；
- 低置信度进入“更多发现”；
- 采集确认/误报标签但不采集原文；
- 每条新规则先在脱敏或授权测试集上离线评估，再灰度开放。

## 11. AI 评测

### 11.1 测试集

建立至少 30 个授权或自建故事片段，覆盖：

- 古代/现代/科幻三类命名体系；
- 倒叙、多 POV、同名角色、别名、身份隐藏；
- 人物死亡/复活、物品易手、地点移动、年龄变化；
- 明示事实、暗示事实、比喻、梦境、假消息；
- 5 万、20 万、50 万字不同规模。

任何真实用户文本进入评测集前必须明确授权、去标识并允许撤回。

### 11.2 指标

- 事实抽取 precision / recall / F1；
- old/new value 与生效点准确率；
- 冲突警告 precision，MVP 门槛 80%；
- 证据定位准确率，门槛 95%；
- 上下文中无关 token 比例；
- 上下文遗漏关键正典比例；
- 候选接受率和修改后接受率；
- 单任务 P50/P95 延迟与成本。

### 11.3 回归门禁

Prompt、模型、检索、切分或 schema 任一变化都运行固定集。若关键事实遗漏、证据错误或隐私字段泄漏任一指标变差，阻止发布，即便文风主观评分提升。

## 12. 同步与加密（V1 预留）

- 每个项目生成数据密钥，服务器只接收加密更新流和密文附件；
- 设备通过用户授权安全交换项目密钥；
- 服务器侧无法全文检索，全文索引在设备本地维护；
- 云 AI 请求尽量从客户端直接发出，避免同步服务接触明文；
- 密钥丢失的恢复策略必须在上线前明确，不能用“端到端加密”掩盖不可恢复风险；
- 同步冲突要保留双方版本，禁止最后写入者静默覆盖。

MVP 不实现 E2EE 同步，但本地数据模型不得依赖服务器递增 ID 或服务器时间，避免未来迁移困难。

## 13. 数据迁移与恢复

### 13.1 格式版本

`manifest.format_version` 和数据库 `schema_version` 分开。应用打开新版本项目时：

1. 校验项目包；
2. 创建迁移前备份；
3. 在临时副本运行迁移；
4. 执行行数、外键、内容哈希与抽样打开检查；
5. 原子替换数据库；
6. 失败则保留旧项目并用旧格式只读打开。

### 13.2 恢复优先级

操作日志恢复 → 最近快照 → 自动备份 → 用户手工备份。恢复永远生成新副本，不直接覆盖唯一原件。

## 14. 技术验证清单

在正式开发前完成以下 spike：

- Tauri 2 + Tiptap 在 Windows/macOS 中文输入法下连续输入、撤销、跨段选择；
- 单场景 1 万汉字、整项目 50 万汉字的内存与切换性能；
- Tiptap JSON → TXT/MD/DOCX → 再导入的 round-trip；
- SQLite WAL、异常断电模拟、备份还原、迁移回滚；
- Mention 锚点经过插入、删除、拆分场景后的修复率；
- 规则检查和 AI 抽取使用同一证据定位协议；
- API Key 在两平台凭据库中的存取和日志脱敏；
- AI 流式输出取消、断网、超时、JSON 非法和上下文超限降级。

任一“不丢字、不丢稿、可恢复”验证失败，优先修复，不进入剧情图和高级 AI 开发。

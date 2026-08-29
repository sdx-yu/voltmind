# 正典关系层 v1（2.3.0）产品与实现规格

状态：范围冻结，进入实现  
日期：2026-08-29  
标语：笔耕不怠，写尽所思。

## 1. 调研结论

- Campfire 将人物表、人物弧和 Relationship Webs 分成互相关联的模块，关系图用于友情、敌对、爱情、家族等连接；人物表允许大量属性与自定义模板。可借鉴“档案与图分层”，不照搬百字段必填表。
- Plottr 的人物 Custom Attributes 支持短文本/长文本、自定义、排序和删除。可借鉴低门槛的可配置字段，避免把类型学或固定问卷强加给所有作者。
- World Anvil 从人物条目建立家庭/扩展关系，图由关系自动生成，并可聚焦人物、切换方向和缩放。可借鉴“条目是主数据、图是投影”，不维护第二份图数据。
- React Flow 的无障碍规范强调节点/边可聚焦、Tab 导航、Enter/Space 选择、聚焦后进入视口。2.3.0 不引入画布依赖，但关系图仍采用同等原则，并始终提供信息等价的列表视图。

## 2. 产品定位

正典关系层不是人物百科或自由白板，而是“某个场景时点成立的人物关系真值”。作者可从人物档案建立关系，在故事推进后追加关系状态；系统按场景解析当前关系，正文候选必须经作者确认，AI 只读取当前有效且允许进入上下文的关系。

核心闭环：

`建立关系 → 场景发生变化 → 形成候选 → 作者确认 → 下一场景显示当前关系 → 点击证据回到正文 → AI 读取当前关系`

## 3. MVP 范围

### 3.1 人物档案

- 可自定义字段，不设必填大问卷。
- 字段包含分类、名称、内容、隐私级别和排序。
- 默认建议分类：身份、外貌、背景、性格、语言、目标、其他；作者可输入自定义分类。
- 档案描述相对稳定或作者规划信息；会随时间变化的事实继续使用“时态状态”。

### 3.2 结构化关系

- 起点、终点、关系类型、方向、显示名称、摘要、隐私级别。
- 支持现有正典类型人物、地点、物品、事件之间的连接。
- 内置关系类型只是快捷项：亲属、爱情、朋友、对手、师徒、同盟、上下级、归属、债务、自定义。
- 同一逻辑关系拥有多个时间状态，每个状态含状态名、说明、生效场景/失效场景、世界时间区间、证据场景和证据原句。
- 相同关系的状态区间不可重叠。
- 新变化给出明确起点时，系统会把上一条仍开放的状态关闭在该起点；其他重叠仍会阻断。

### 3.3 查询与图谱

- 人物详情分为概览、档案、状态、关系、证据。
- 关系页提供列表/关联图两种等价视图。
- 可选“当前场景”；系统据叙事顺序或故事时间计算当前有效状态。
- 图以当前人物为中心自动排布，不保存坐标、不允许自由拖拽；点击节点切换正典项，点击证据回到正文。
- 图节点使用原生按钮并有可见焦点；关系列表始终保留，避免图成为唯一入口。

### 3.4 候选、AI 与数据安全

- `relationship_state/set_state` 候选只有接受或修改后接受才写入关系状态。
- AI 上下文只加入当前场景有效、与本场景已提及实体相连、且非 `local_private` 的关系。
- 普通 `.bbd-backup` 备份并重映射档案、关系、关系状态和证据场景。
- `bbd-sync-v1` 把档案和关系作为正典实体投影的一部分同步；结构化并发仍沿用正典对象冲突策略。
- 关系图本身不存储数据，因此不存在图与正典分叉。

## 4. 明确不做

- 组织/阵营新实体类型、家谱专用配偶/血缘推导、3D 图、无限画布、手工保存节点坐标。
- MBTI、星座、阵营九宫格等强制模板。
- AI 自动接受关系或直接写入正典。
- 云端账号、在线协作和实时多人编辑。

## 5. 数据模型

### `entity_profile_fields`

`id, entity_id, category, label, value, sort_key, privacy_level, created_at, updated_at`

### `entity_relationships`

`id, project_id, source_entity_id, target_entity_id, relation_type, direction, label, summary, privacy_level, created_at, updated_at, deleted_at`

### `relationship_states`

`id, relationship_id, status_label, note, valid_from_node_id, valid_to_node_id, world_time_from, world_time_to, source_node_id, evidence, created_at`

## 6. 验收标准

1. 人物可新建、修改、删除自定义档案字段，重启后仍在。
2. 可建立两个正典项的定向或双向关系，不能自关联，不能创建同向重复关系。
3. 可追加时间状态；重叠区间被拒绝；选择第 39/40 场景可得到不同当前关系。
4. 列表与关联图展示相同关系；键盘可聚焦节点；选择节点能打开对应正典项。
5. 证据按钮能回到来源场景。
6. 关系状态候选在未接受前不改变正典，接受后产生正典事件和来源事件。
7. AI 场景上下文只包含当前有效、非本地私密关系。
8. 备份恢复后实体、档案、关系、状态、场景引用均正确重映射。
9. 加密接力能携带档案和关系；同一正典对象的并发修改仍显式冲突。
10. 类型检查、单元测试、生产构建、UI 基础检查和真实浏览器验收全部通过。

## 7. 参考资料

- Campfire Write / Relationship Webs：https://www.campfirewriting.com/write
- Campfire Character Builder：https://campfirewriting.com/character-builder
- Plottr Custom Attributes：https://docs.plottr.com/article/84-characters-custom-attributes
- World Anvil Family Trees：https://www.worldanvil.com/learn/family-trees/family-trees-guide
- React Flow Accessibility：https://reactflow.dev/learn/advanced-use/accessibility

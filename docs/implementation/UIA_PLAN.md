# UI-A 设计基础（1.7.0）

基线：[UI 统一规划与设计方案 v1.0](UI_SYSTEM_PLAN_V1.md)

状态：本机工程通过（2026-08-28）。

## 目标

建立后续 UI-B～UI-E 都必须复用的设计基础，先解决颜色、字体、间距、密度、组件状态和复杂弹层行为，再迁移导航和业务页面。UI-A 不改变现有四个一级工作台，不重写业务数据和服务协议。

## 已完成范围

### 1. 变量与主题

- `src/ui/tokens.css`：24 个原始色板槽位、43 个必需语义变量；
- 宣纸、夜间、高对比三种主题；
- Canvas、Paper、Tool 三层表面；
- 字体、间距、圆角、阴影、动效、左右栏宽度和控件高度变量；
- 旧 `--paper/--canvas/--accent` 等变量通过语义变量兼容，业务页面无需一次性重写；
- `src/ui/foundations.css`：字体阶梯、焦点、屏幕阅读器文本、减少动态效果和三档密度。

### 2. 三档密度

- 舒适：默认桌面工作；
- 紧凑：正典、检查结果和高密度列表；
- 触控：控件目标不低于 44px；
- 显示设置可以保存主题与密度，旧设置自动迁移到舒适密度。

### 3. 基础组件

`src/ui/` 已提供：

1. Button / IconButton；
2. TextField / TextareaField / SelectField / CheckboxField / SwitchField；
3. Tabs / SegmentedControl；
4. PageHeader；
5. Pane；
6. Card；
7. ListRow / TreeRow；
8. Badge / InlineNotice / ToastNotice；
9. ModalDialog / Drawer / Popover / DropdownMenu；
10. EmptyState / LoadingState / ErrorState / Skeleton；
11. Toolbar / ToolGroup；
12. 统一状态、尺寸、主题和密度样式。

复杂弹层使用 Radix Primitives 处理焦点约束、Esc、键盘导航、浮层定位和屏幕阅读器语义；视觉完全由笔不怠变量控制。现有 Modal、EmptyState、Toast 已接入新基础层，证明兼容路径可行。

### 4. Design Gallery

开发环境访问：

```text
http://127.0.0.1:4318/design-system
```

画廊覆盖变量、三主题、三密度、按钮、字段、选择、页签、容器、卡片、列表、状态、弹层、菜单、空/加载/失败和通知。生产构建不开放该路由。

### 5. 防漂移门

`npm run ui:check` 检查：

- 必需语义变量和主题是否完整；
- 原始色板槽位是否超过 24；
- 新 UI CSS 是否在 `tokens.css` 之外写裸颜色；
- 旧 `src/styles.css` 的颜色和 `!important` 是否超过冻结基线；
- 基础组件是否统一导出；
- Design Gallery 是否只在开发态开放。

该检查已进入 `npm run check`，后续提交无法静默绕过。

## 完成定义

- `npm run ui:check` 通过；
- 类型检查、全量测试和生产构建通过；
- 三种主题真实渲染可辨、层级清楚；
- 组件画廊可完成主题、密度、页签、弹层和抽屉交互；
- 现有书架和对话框没有基础层接入回归；
- 旧显示设置向前兼容；
- 1.7.0 Web/PWA/Tauri/研究诊断版本一致。

## UI-A 边界

- `src/styles.css` 仍包含业务阶段累积的 226 个唯一裸颜色；UI-A 冻结存量、不伪装成已迁移完成；
- 现有“写作、剧情、正典、交付”导航保持不变，避免与基础层同时大改；
- 旧业务页面尚未全部达到高对比主题和基础组件覆盖门；
- 响应式业务页面重排、五模式信息架构和命令面板属于 UI-B；
- 页面模板化属于 UI-C/UI-D。

## 下一阶段

进入 **UI-B / 1.8.0 壳层与信息架构**：实现五模式导航、全局工具区、命令面板、书架动作降噪、左右栏状态持久化和长尾功能迁位，并逐步用 UI-A 组件替换旧控件。

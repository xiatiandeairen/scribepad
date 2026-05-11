# Feature Plan: Review 面板日常使用流优化

## 目标

让 scribepad 在日常 vibe coding 前置 plan review 中成为执行前确认面板，帮助用户在开始编码前快速确认范围、风险和验收点。

成功标准:

- 用户能在 1 分钟内判断当前 plan 是否足够可执行。
- 用户能按 outline 逐项确认并锁定关键内容。
- 顶部栏只展示全局状态，不承载复杂 review 信息。
- Review 面板承担 plan 聚焦、风险提示和锁定动作。

## 范围

当前应用已经支持从 markdown 中抽取 plan 信息点，并在右侧 Review 面板中展示 Feature Review Outline。用户可以对信息点进行 default / locked 切换，正文左侧也会显示 plan rail marker。

当前主要问题:

- 顶部栏仍容易承载过多 review 信息。
- Signals 和 Review 面板内容必须严格对齐。
- 用户需要明确知道哪些 section 必须确认后才算 review 完成。
- Review 面板需要服务“编码前确认”这个核心场景。

本次只优化 feature plan review 场景。

包含:

- Review 面板内的信息层级。
- Signals 与 outline 的对应关系。
- 锁定完成后的完成态。
- 空状态、缺失状态和 stale 状态。
- 相关 e2e 覆盖。

不包含:

- 多种 Review style。
- AI 自动审计。
- 多文档协同。
- 版本历史。
- 复杂权限或多人审批。

- plan 信息抽取规则过强，可能误判轻量文档。
- Readiness 百分比可能让用户误以为是质量评分。
- Signals 如果过多，会重新变成噪音。
- stale hash 只基于文本，结构调整时可能仍有边界问题。

## 方案

### 用户流程

#### 打开 plan 文档

用户打开一份 markdown feature plan。

系统自动:

- 渲染正文。
- 抽取 plan 信息点。
- 判断是否进入 structured / annotation-only。
- 在右侧显示 Review 面板。

#### 查看顶部状态

顶部栏只展示全局状态:

- Readiness: 当前 focused points 的 locked 比例。
- Comments: 当前批注数量。
- Signals: hover 展示哪些 section 还没确认。

顶部不展示:

- Decided。
- Review style selector。
- 详细风险列表。

#### 查看 Review 面板

Review 面板展示:

- Handoff Readiness。
- Feature Review Outline。
- 按 section 分组的信息点。
- 每个 section 的 locked 数量。
- 每个 item 的当前状态。

核心 section:

- Goal
- Scope
- Behavior
- Decisions
- Risks
- Tasks
- Verification

#### 逐项确认

用户点击 outline item:

- default -> locked
- locked -> default
- stale -> locked

点击后:

- 右侧 item 状态更新。
- 正文 rail marker 状态更新。
- Readiness 重新计算。
- Signals 对应 section 减少或消失。

#### 完成 Review

当所有 focused points 都 locked:

- Handoff Readiness 显示 Ready for handoff。
- Signals 显示无阻塞提示。
- 用户可以开始编码执行。

### 信息展示逻辑

#### Readiness

Readiness = locked focused points / total focused points。

只计算 Review 面板实际展示的 focused points。

不计算:

- 普通批注。
- 已 applied 的 annotation。
- 不在 feature plan 模板中的杂项文本。

#### Signals

Signals 只做轻提示，不做详情列表。

显示规则:

- 如果某个 section 有 open item，显示 `{Section} 未确认`。
- 如果某个 section 有 stale item，显示 `{Section} 需复核`。
- 如果无 open/stale item，显示 `Review 面板当前没有待处理项`。

Signals 必须和 Review 面板 section 对齐。

#### Section 状态

每个 section 显示:

- `missing`: 没有识别到该类内容。
- `0/N locked`: 有内容但未锁定。
- `N/N locked`: 全部锁定。
- stale item 优先提示需复核。

#### Item 状态

只保留两种用户可操作状态:

- default: 未确认。
- locked: 已确认。

系统派生状态:

- stale: 之前 locked，但原文内容变更，需要重新确认。

### 交互规则

- 点击 item 直接切换状态，不弹确认。
- 点击 section title 定位到该 section 第一个待处理 item。
- Signals 不作为操作入口，hover / focus 只展示提示。
- 点击正文 rail marker 定位并高亮对应 item。
- Review tab 和 Comments tab 保持独立。

- Review 面板只保留一种默认设计。
- 顶部栏只保留全局轻量状态。
- Signals 只做 hover 提示，不做操作入口。
- 用户确认状态只保留 default / locked。
- stale 是系统派生状态，不是用户手动状态。

## 验收

功能验收:

- 打开 sample plan 后默认显示 Review 面板。
- 顶部没有 Review style selector。
- 顶部没有 Decided。
- Signals hover 内容与 Review section 对齐。
- 点击 outline item 可锁定。
- locked 状态刷新后保持。
- 修改原文后 locked item 变 stale。
- stale item 点击后重新 locked。
- 全部 locked 后 Readiness 为 100%。

UI 验收:

- 顶部栏不换行拥挤。
- Signals tooltip 不超出移动端视口。
- Review 面板移动端首屏可见。
- Outline 长文本不撑破容器。
- 状态文字不重叠。

测试验收:

- P0 主流程通过。
- Review panel render 通过。
- Signals hover 与 section 对齐。
- Lock / persist 通过。
- Stale / relock 通过。
- Mobile overflow 通过。

## 待确认

- Risks 是否计入必须 locked 的 focused points？
- missing section 是否影响 Readiness？
- Signals 是否最多显示 5 条，剩余显示 `+N`？
- Ready for handoff 后是否隐藏 Signals？

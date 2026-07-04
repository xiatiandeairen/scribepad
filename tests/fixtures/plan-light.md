# 本地配置迁移（light plan）

> light tier：仅包含 goal / behavior / verification 三节，无决策分叉，total points ≤ 8

## 目标

- **G1** 将现有硬编码配置提取到环境变量，可判定标准：`process.env.X` 替代所有硬编码值，`rg -r '旧值'` 零命中。

## 做法

1. 扫描仓库，找出所有硬编码配置项，产出：配置清单文档。
2. 将配置项迁移到 `.env.example` 并更新代码引用，产出：完整 PR。

## 验收

- [ ] **G1** `rg -r '旧值'` 零命中；`.env.example` 包含全部配置项。

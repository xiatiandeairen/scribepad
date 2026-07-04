# Auth 重构：SOC2 合规的会话管理

> 状态：待 review | 交付期限：2026 Q2（SOC2 审计窗口）| 本文档 8 节，核心决策在 §3

## 目标

**为什么做**：当前登录态是一个自包含 JWT，直接存放在浏览器 cookie 中。两个问题：(a) JWT payload 仅 base64 编码，用户 ID、角色等信息在客户端可直接解出；(b) JWT 签发后到过期前无法撤销——注销、封号、改密码都不能让已发出的 token 失效。合规团队评估这两点均不满足 SOC2 的会话管理控制项，要求 2026 Q2 审计前完成重构。

**成功约束（硬约束，方案取舍与验收都以此为准）**：

| # | 约束 | 可判定标准 |
|---|---|---|
| G1 | 会话即时撤销 | 撤销动作（注销/封号/改密码）生效延迟 ≤ 下一次请求，无缓存窗口 |
| G2 | 敏感载荷不暴露在客户端 | 客户端持有的凭证是不可解读的随机标识，不含任何业务数据 |
| G3 | 赶上审计窗口 | 2026 Q2 前在 prod 全量生效（含迁移窗口收尾） |
| G4 | 不降用户体验 | 登录态时长与自动续期行为与现状一致；鉴权 p95 延迟增幅 ≤ 5ms |

## 边界

**范围内**：Web 端登录（签发/续期/注销）、API 网关鉴权（JWT 校验中间件换成 session 校验）、第三方 OAuth 回调（回调成功后从签 JWT 改为建 session）、存量登录态迁移（双跑窗口，见 D3）、会话生命周期审计日志（SOC2 evidence）。

**范围外（non-goals，agent 不得触碰）**：

- **不做** MFA / 密码策略改造 —— 合规的另一控制项，另行立项
- **不改** 登录 UI 和第三方 OAuth 协议流程 —— OAuth 仍是身份来源，只换回调后的凭证形态
- **不动** 权限模型（RBAC）—— 角色仍由现有 authz 服务按请求解析，session 里不存角色
- **不做** 对外 token 签发（OAuth provider 化）、企业 SSO 接入
- **不做** 多 region session 复制 —— 当前单 region 部署，跨区是伪需求

## 决策

### D1（核心）：会话机制选 **服务端 Session（Redis-backed）** ✅ 已定

**选了什么**：网关签发 128-bit 加密随机 session ID，经 `__Host-sid` cookie（HttpOnly / Secure / SameSite=Lax / Path=/，无 Domain）下发；会话数据存 Redis，客户端只见随机串。

**为什么（逐条对齐硬约束）**：

- **G1**：撤销 = 删 Redis key，下一次请求即 401。三候选中唯一"删除即全端失效、零延迟窗口"。
- **G2**：payload 完全留在服务端，cookie 只有随机 ID，天然满足。
- **G3**：改动集中在网关鉴权中间件的同一插槽（JWT 校验位置换成 Redis lookup），交付面最小。

**否掉了谁**：

| 候选 | 被否理由 |
|---|---|
| C. OAuth2 + OIDC | 违反 G1：OIDC access token 是 JWT，过期前无法即时撤销；要真即时得加服务端 denylist，等于绕回方案 B 还多背 IdP 集成运维；且 IdP 选型/迁移工作量威胁 G3。（现有第三方 OAuth **登录**不在被否范围，继续作身份来源） |
| D. 不透明 token（bearer header） | G1/G2 能满足，但败在存放位置：浏览器只能放 localStorage/内存，XSS 可窃取；若改放 HttpOnly cookie 则与方案 B 同构却要自建签发校验层，纯增成本。适用非浏览器客户端（见 Q3），非本期主战场。 |

### D2：Redis 不可用时 **fail-closed** ✅ 已定

网关对 Redis lookup 设 50ms 超时，超时/失败返回 503 + 告警，**不放行**。理由：SOC2 语境下"鉴权失效时放行"是审计红线；可用性靠 Redis HA 化解（P1、R1）。fail-open 因违背合规目标被否。

### D3：迁移采用 **双跑窗口 + 旧 JWT 自然过期** ✅ 已定

上线后新登录只发 session，网关同时接受旧 JWT 与新 sid；停止 JWT 签发，等存量 JWT 自然过期（TTL 见 Q1）后关闭 JWT 校验。理由：强制全员重登录制造工单峰值且对 G1-G3 无帮助。hard cutover 因体验代价被否。窗口期撤销缺口是已识别风险（R2），有兜底。

## 做法

按序执行，每步独立可验：

1. **基础设施**：接入 managed Redis（multi-AZ，选型见 Q2）。key：`sess:{sid}` → `{uid, created_at, last_seen}`（idle TTL 滑动续期，值见 Q4，开发按 24h）；`user_sess:{uid}` → sid 集合（撤销全部会话用的二级索引）。
2. **签发**：登录/OAuth 回调成功后生成 sid（`crypto` 级随机 128-bit，base64url），写 Redis，`Set-Cookie: __Host-sid=...; HttpOnly; Secure; SameSite=Lax; Path=/`。不再签 JWT。
3. **校验**：网关中间件读 cookie → Redis lookup → 命中注入 `uid`（角色仍由下游 authz 解析）→ 滑动续期。续期按 sid 节流每 60s 至多一次，避免写放大。未命中/超时按 D2。
4. **撤销**：三入口全走"删 `sess:{sid}` + 从 `user_sess:{uid}` 移除"：`POST /logout`（删当前）、改密码（遍历删全部）、管理端 `POST /admin/users/{uid}/revoke-sessions`（需 admin）。
5. **审计日志**：`session.created`、`session.revoked {reason}` 写现有审计管道（保留时长见 Q4）。过期不记。
6. **迁移**：feature flag `session_auth` 控制双跑；窗口结束后删除 JWT 校验路径与 flag，不留死代码。

## 验收

全部可勾选，逐条对应硬约束：

- [ ] **G2** 浏览器可见凭证仅随机 sid，base64 解不出用户数据
- [ ] **G2** cookie 属性齐全（`__Host-`/HttpOnly/Secure/SameSite=Lax），集成测试断言
- [ ] **G1** 管理端撤销后，该用户下一次 API 请求返回 401（e2e）
- [ ] **G1** 改密码后其他设备会话全失效，当前会话按 Q5 决定
- [ ] **D2** 关停测试 Redis，请求 503 + 告警，无一放行
- [ ] **D3** 双跑窗口结束后旧 JWT 一律 401，JWT 代码路径已删
- [ ] **G4** 网关鉴权 p95 延迟增幅 ≤ 5ms（对比上线前 baseline）
- [ ] 压测：2× 峰值 QPS 下 Redis lookup 错误率 < 0.01%
- [ ] 审计日志 create/revoke 事件完整，抽样核对

## 风险

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | Redis 成鉴权单点，配合 D2 = 故障即全站不可用 | 高 | managed multi-AZ（P1）；50ms 快失败；故障 runbook 演练后才全量 |
| R2 | 双跑窗口内旧 JWT 仍不可即时撤销（G1 窗口期不完整） | 中 | 窗口期安全事件按 runbook 轮换 JWT 签名密钥使旧 JWT 立即全失效；窗口有明确截止 |
| R3 | 滑动续期写放大 | 中 | §4.3 定死按 sid 节流 60s；压测兜底 |
| R4 | 团队无 Redis 运维经验 | 中 | managed service 转移运维面（P1）；只需掌握监控与 failover 演练 |
| R5 | 存在未识别的非浏览器 JWT 消费方，窗口关闭时被误伤 | 中 | Q3 动工前查网关日志；若有则为其保留兼容路径并另立迁移 plan |

## 前置

不满足则对应步骤不得开工：

- **P1**（卡 §4.1）：managed Redis（multi-AZ）staging + prod 就绪 —— owner: infra
- **P2**（卡 §4.3）：确认网关鉴权中间件插槽可替换 —— owner: 后端，1 天内可验
- **P3**（卡 §4.6）：feature flag 系统可用（LaunchDarkly，确认网关侧 SDK 已接）—— owner: 后端
- **P4**（卡 §4.5）：合规给出审计日志保留时长 —— owner: 合规，与 Q4 合并

## 待确认

核心决策（D1-D3）不依赖以下任何一项，均不卡开工，但卡各自标注环节：

| # | 问题 | owner | 卡什么 | 截止 |
|---|---|---|---|---|
| Q1 | 现有 JWT 实际 TTL（决定双跑窗口长度；>14 天则改主动轮换密钥收窗） | 后端 | §4.6 | 动工前 |
| Q2 | managed Redis 选型：ElastiCache vs Upstash | infra | P1 | 动工前 |
| Q3 | 是否存在非浏览器客户端消费现有 JWT | 产品+后端 | R5、验收第 6 条 | 动工前 |
| Q4 | session idle/absolute TTL 值 + 审计保留时长 | 合规 | §4.1、§4.5 | 上线前（开发用 24h 占位） |
| Q5 | 改密码时当前会话是否保留（体验 vs 安全） | 产品 | 验收第 4 条 | 上线前 |

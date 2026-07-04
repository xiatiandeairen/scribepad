/* ═══════════════════════════════════════════════════════════════════
   Spec Plan — fixture 数据（plan-data-backend.md 的 ExtractResult 形态）
   ═══════════════════════════════════════════════════════════════════
   本文件是唯一的「内容」文件：正文全部在这里，形状对齐后端契约
   （契约字段 vs UI 扩展字段的划分见 plan-contract.jsx 头注释）。
   接真实后端时删除本文件，改由 adaptExtract() 提供同形数据。
   文中 "{G1}" token 由 <T> 渲染为可跳转标签芯片。 */

const PLAN_META = {
  project: 'writ',
  file: 'plan-data-backend.md',
  title: 'Plan 场景数据后端落地：三模型收敛 + core 抽取',
  status: '待 review',
  branch: '接 refactor/core-ports-foundation 之后',
  fixture: '本文档按新 8 节模型书写，落地后作为抽取器 fixture（{§4.6}）',
  tldr: '把 plan 场景并存的三套重叠数据模型收敛为一套 8 类新模型：抽取逻辑下沉 core、砍掉「锁 / 防漂移」整条线、用标签 + 交叉引用打 grounding 地基，并为新前端定稿 GET /api/extract 契约。旧路径按 Strangler 原样保留，等新前端接上后退休。',
};

/* ── 各节展示配置（kicker / 引导语 / 富块）── */
const PLAN_SECTIONS = [
  { id:'goal', kicker:'为什么做 · 以什么为准',
    lead:'plan 场景内部并存三套重叠模型，记的是同一件事——「文档里这条信息定了没」。三套 kind 分类 + 三套状态机并行，新前端（Claude Design 另行设计中）对接时无从选择，卡死。',
    brief:'为什么做 + 5 条硬约束（G1–G5）',
    extras:{
      models:[
        { name:'PlanItem', loc:'types/plan.ts · plan-inspector.ts（687 行，前端）',
          kinds:'5 类', state:'open / locked / stale', now:'在用', tone:'g', note:'现有前端 Review 面板' },
        { name:'ExtractedItem / Gap / ConfirmState / ContextPack', loc:'types/domain.ts + core/schema.ts',
          kinds:'7 类（带 confidence）', state:'open / confirmed / rejected', now:'死 seam', tone:'r', note:'全仓无 producer / consumer，core 侧抽取从未实现' },
        { name:'Annotation.state', loc:'types/annotation.ts',
          kinds:'—', state:'draft / discussed / decided', now:'在用', tone:'g', note:'批注生命周期' },
      ],
      penetration:'旧模型渗透面（收敛不能原地拆换的依据）：旧 plan 模型标识符在 src/ 6 个文件约 140 处命中（plan-inspector.ts 91 / App.tsx 25 / PlanPanel.tsx 12 / Reader.tsx 8 / lib/api.ts 4 / review-normalize-validation.ts 2）；8 个 e2e spec 中 4 个断言 locked / plan-state 行为。',
    }},
  { id:'scope', kicker:'agent 不得越界的范围约定', brief:'范围内 6 项 / 范围外 5 条 non-goals' },
  { id:'dec',   kicker:'选了什么 · 为什么 · 否掉了谁', brief:'D1–D4，均已定；核心决策在此' },
  { id:'how',   kicker:'按序执行 · 每步一个 commit',
    lead:'按序执行；每步（含子步）单独 commit、五道闸绿（{G1}）。commit 排序遵循 chore(deps) → refactor → feat → test。',
    extras:{
      tree:[
        ['core/extract/',''],
        ['├── sections.ts','H2 切分 + 8 节分类（alias 表扩到 8：目标 / 边界 / 决策 / 做法 / 验收 / 风险 / 前置 / 待确认）'],
        ['├── points.ts','节内容 → ExtractedItem[]（+ GFM 表格数据行 → 点、checkbox 列表项 → 点）'],
        ['├── decisions.ts','决策节 H3 → DecisionCard（✅ 已定 → status；三段缺失降级为 chosen=全文，不报错）'],
        ['├── labels.ts','标签识别 + refs 扫描 + byLabel / relatedPoints 纯函数（出边 refs + 入边反查）'],
        ['└── index.ts','extract(source: string): ExtractResult'],
      ]}},
  { id:'acc',  kicker:'全部可勾选 · 逐条挂硬约束', brief:'9 条可勾选断言，逐条挂硬约束' },
  { id:'risk', kicker:'影响 + 缓解 · 2 中 3 低' },
  { id:'pre',  kicker:'不满足则对应步骤不得开工，均需产品负责人拍板：' },
  { id:'open', kicker:'核心决策（D1–D4）不依赖以下任何一项，均不卡开工，但卡各自标注环节：' },
];

/* ═══ extract.points ═══ */
const px=(p)=>({ source:'rule', refs:[], ui:{}, ...p });

const POINTS_FIXTURE = [
  /* ── §1 目标：硬约束（role:gate）── */
  px({ id:'G1', label:'G1', kind:'goal', role:'gate', title:'迁移期 app 任何时刻可开可审',
    text:'每个 commit 五道闸全绿：typecheck（3 tsconfig）/ lint（含 E0）/ test / build / test:e2e' }),
  px({ id:'G2', label:'G2', kind:'goal', role:'gate', title:'内核可移植性不破',
    text:'core/ 依赖白名单 = types/ + zod + mdast 解析库（见 {D2} / {P3}）；tsconfig.core.json 独立 typecheck 绿' }),
  px({ id:'G3', label:'G3', kind:'goal', role:'gate', title:'新模型达到标杆解析力',
    text:'core/extract 解出 plan-auth-soc2.md 全部 8 节 + 3 张决策卡三段 + 标签交叉引用（量化断言见 {§5}）' }),
  px({ id:'G4', label:'G4', kind:'goal', role:'gate', title:'旧路径迁移期不回归',
    text:'现有前端 5 类抽取 / 批注 / rewrite / 锁持久化行为不变；plan-inspector 单测与现有 e2e 断言不改仍绿（唯一例外：{D3} 主动砍除的服务端 decided 过滤）' }),
  px({ id:'G5', label:'G5', kind:'goal', role:'gate', title:'持久化迁移不丢用户数据',
    text:'sidecar load→save round-trip 后 annotations 逐字段相等；文件中既有 planState / 未知字段字节保留（单测锁定）' }),
  /* ── §1 目标：已核实 bug（role:bug）── */
  px({ id:'B1', label:'B1', kind:'goal', role:'bug', title:'「锁定即防改写」从未对 PlanItem 生效',
    text:'core/rewrite.ts 的防漂移过滤只认 state === "decided" 的 annotation id（L60-63）；session-manager.rewrite() 只 load annotations，locked 的 PlanItem（planState）根本不进过滤。' }),
  px({ id:'B2', label:'B2', kind:'goal', role:'bug', title:'重新划选即绕过 decided 保护',
    text:'过滤按 annotation id 匹配 RewriteItem.id。同一段文字重新划选会生成新 annotation（新 id），旧 decided 保护即被绕过。' }),

  /* ── §2 边界 ── */
  px({ id:'sc-in-1', kind:'scope', role:'in', text:'新数据模型 types：8 类信息点 + 决策卡 + 锚点原语 + source / confidence 字段位' }),
  px({ id:'sc-in-2', kind:'scope', role:'in', text:'core 抽取（core/extract）：mdast 8 节 + 决策卡 + GFM 表格 / checkbox' }),
  px({ id:'sc-in-3', kind:'scope', role:'in', text:'grounding 标签 + 交叉引用解析' }),
  px({ id:'sc-in-4', kind:'scope', role:'in', text:'持久化瘦身：ReviewStore 端口只留 annotations' }),
  px({ id:'sc-in-5', kind:'scope', role:'in', text:'新 API 契约：types/api.ts + GET /api/extract' }),
  px({ id:'sc-in-6', kind:'scope', role:'in', text:'单测锁行为' }),
  px({ id:'sc-out-1', kind:'scope', role:'out', ui:{ verb:'不做', rest:'前端' },
    text:'新前端由产品负责人用 Claude Design 另行产出，本期只交付其消费的数据层与 HTTP 契约' }),
  px({ id:'sc-out-2', kind:'scope', role:'out', ui:{ verb:'不做', rest:'AI 抽取' },
    text:'纯规则化解析；source / confidence 只留字段位，本期不产出不消费' }),
  px({ id:'sc-out-3', kind:'scope', role:'out', ui:{ verb:'不做', rest:'质量缺陷的工具处理' },
    text:'缺节提示 / 自动补全全 defer，旧 Gap 类型随死 seam 一并移除，需要时再立' }),
  px({ id:'sc-out-4', kind:'scope', role:'out', ui:{ verb:'不设计', rest:'价值度 / 置信度逻辑' },
    text:'只留字段位（{Q2}，⚠ TBD by design）' }),
  px({ id:'sc-out-5', kind:'scope', role:'out', ui:{ verb:'不删', rest:'旧路径' },
    text:'plan-inspector.ts、/api/plan-state、旧前端锁 UI 原样保留（Strangler），等新前端接上后按退休条款删（{Q3}）' }),

  /* ── §4 做法（role:step，ui.num/file/pts/subs/tree）── */
  px({ id:'S1', label:'S1', kind:'behavior', role:'step', title:'新模型类型',
    ui:{ num:'1', file:'types/domain.ts 原地演进 + core/schema.ts 同步',
      pts:[
        'InfoKind 7 类 → 8 类：新增 precondition（前置）。8 类与 8 节一一对应（{P1}）',
        'ExtractedItem 演进：新增 label? / refs / textHash / source（本期恒 "rule"）；confidence 改 optional（字段位）；anchor 保留 optional（规则抽取恒有值，optional 留给 AI seam）',
        '新增 DecisionCard（chosen / rationale / rejected[] / status）；ExtractResult 改为 { points, decisions }',
        '删除 Gap / GapKind / ContextPack 死类型；ConfirmState 本步不动（{§4.4} 原子摘除，保持每个 commit 可编译）',
        'core/schema.ts 同步重写，保持 satisfies z.ZodType 编译期防漂移绑定（命名定稿见 {Q4}）',
      ]}}),
  px({ id:'S2', label:'S2', kind:'behavior', role:'step', title:'core 抽取',
    ui:{ num:'2', file:'core/extract/ · 新增 deps：mdast-util-gfm + micromark-extension-gfm', tree:true,
      pts:[
        'id 规则：label ?? kind:sectionOrder:groupKey:itemOrder（后者逐字沿用 plan-inspector 现算法）',
        '非 8 节文档（如 sample.md）降级返回部分 / 空结果，不 throw；src/lib/plan-inspector.ts 与其单测一行不动（{G4}）',
        '同 commit 更新 docs/architecture.md：core 依赖白名单扩为 types/ + zod + mdast 解析库（{P3} 拍板后）',
      ]}}),
  px({ id:'S3', label:'S3', kind:'behavior', role:'step', title:'grounding 交叉引用',
    ui:{ num:'3', file:'已并入 §4.2 的 labels.ts（拆出来只是叙述单位）',
      pts:[
        'refs 扫描排除自身 label；悬空引用原样保留在 refs 中，由消费方决定呈现——本期不做校验告警（属质量工具，范围外）',
        'relatedPoints 即上下文包雏形：给定点 id，沿引用图收集依据与被依据点（{D4}）',
      ]}}),
  px({ id:'S4', label:'S4', kind:'behavior', role:'step', title:'持久化瘦身',
    ui:{ num:'4', file:'三个独立 commit',
      subs:[
        { k:'4a', t:'ConfirmState 全链摘除', d:'一个原子 commit，涉 6 文件：types/domain.ts / types/ports.ts / types/annotation.ts / core/schema.ts / store-sidecar.ts / 单测。零用户可见影响。' },
        { k:'4b', t:'ReviewState 去 planState', d:'端口收敛为 { annotations }。旧锁持久化改走 legacy shim（loadPlanState / savePlanState，文件头 HACK(delete with old-path retirement, {Q3}) 标注）。旧前端锁行为（含刷新后保留）不变，{G4} 保住；sidecar version: 4 不 bump——save 先 spread existing 保证存量字段字节不丢（{G5}），单测锁死该机制。' },
        { k:'4c', t:'rewrite 防漂移过滤删除', d:'rewriteItems 去掉 existingAnnotations 参数与 decidedIds 过滤及「全部 decided 则 throw」分支；session-manager.rewrite() 不再 loadState；decided.spec.ts 删「server blocks rewrite」断言（保留 decided 卡渲染断言）。{B1}/{B2} 随之消亡。' },
      ]}}),
  px({ id:'S5', label:'S5', kind:'behavior', role:'step', title:'API 契约',
    ui:{ num:'5', file:'types/api.ts + server/routes/extract.ts',
      pts:[
        'types/api.ts 新增 GET /api/extract → ExtractResponse { result: ExtractResult }；PlanStateRequest/Response 加 @deprecated（随旧路径退休删除，{Q3}）',
        'server/routes/extract.ts 沿现有路由形态；session-manager 新增 extract(id)：docSource.read → core/extract，抽取结果不持久化（每次重算，沿用既有约定）',
        '新前端消费面就此定稿：GET /api/extract + 现有 /api/annotations、/api/rewrite、/api/file（{P4} 对齐后不再动形状）',
      ]}}),
  px({ id:'S6', label:'S6', kind:'behavior', role:'step', title:'单测锁行为',
    ui:{ num:'6', file:'tests/unit + fixtures',
      pts:[
        'fixtures ≥3 个不同形态样本（避免 N=1 过拟合，{R2}）：plan-auth-soc2.md 标杆全量 / 本文档 / 旧 5 节格式样本 / 缺节无标签退化样本',
        'extract.test.ts：{§5} 验收全部量化断言 + 决策卡降级、悬空引用、非 8 节降级',
        'store-sidecar.test.ts：{G5} round-trip 断言；旧路径回归：plan-inspector.test.ts 与 review-ui / p0 / comprehensive e2e 不改断言全绿',
      ]}}),

  /* ── §5 验收（refs[0] 为归组硬约束）── */
  px({ id:'A1', label:'A1', kind:'verification', refs:['G1'], text:'每个 commit 五道闸全绿（typecheck×3 / lint / test / build / test:e2e），迁移全程 npm run dev 可开可审' }),
  px({ id:'A2', label:'A2', kind:'verification', refs:['G2'], text:'tsc -p tsconfig.core.json 绿；core/ 内 import 仅 types/、zod、mdast 解析库；ESLint E0 绿' }),
  px({ id:'A3', label:'A3', kind:'verification', refs:['G3'], text:'extract(plan-auth-soc2.md)：识别全部 8 节；goal 节含 G1–G4 共 4 个带标签约束点；决策 3 张卡且 D1 解析出 chosen / rationale / 2 条 rejected / status=decided；风险 R1–R5、前置 P1–P4、待确认 Q1–Q5 数量与标签逐一正确；验收节 9 个 checkbox 点且 ≥7 个 refs 命中 G/D 标签' }),
  px({ id:'A4', label:'A4', kind:'verification', refs:['G3','D4'], text:'grounding：R2 点的 refs 含 G1；byLabel(result)["D2"] 可导航到对应决策点；悬空引用不报错；有标签点的 id 即 label' }),
  px({ id:'A5', label:'A5', kind:'verification', refs:['G4'], text:'旧路径回归：plan-inspector.test.ts 不改一行通过；review-ui / p0 / comprehensive e2e 断言不改通过；旧前端锁定后刷新页面锁仍在（/api/plan-state 行为不变）' }),
  px({ id:'A6', label:'A6', kind:'verification', refs:['G5'], text:'单测：含 annotations + planState + confirmStates 的存量 v4 sidecar 文件 load→save round-trip 后 annotations 逐字段相等、planState 与未知字段字节仍在文件中' }),
  px({ id:'A7', label:'A7', kind:'verification', refs:['D3'], text:'rg "ConfirmState|confirmStates" 全仓 0 命中；ReviewState 仅含 annotations；core/rewrite.ts 无 decided 过滤且 rewriteItems 签名不含 annotations' }),
  px({ id:'A8', label:'A8', kind:'verification', refs:['S5'], text:'GET /api/extract 对 8 节文档返回完整 ExtractResult；对 sample.md 等非 8 节文档降级返回部分 / 空结果，不 500' }),
  px({ id:'A9', label:'A9', kind:'verification', refs:['S6'], text:'抽取单测覆盖 ≥3 个不同形态 fixture，全绿' }),

  /* ── §6 风险（ui.lvl/risk/fix/short）── */
  px({ id:'R1', label:'R1', kind:'risk', title:'mdast 进 core 扩大依赖面',
    ui:{ lvl:'低', short:'mdast 进 core 扩大依赖面',
      risk:'mdast + GFM 进 core，扩大内核依赖面，集成方 bundle 增重',
      fix:'均为无框架纯 ESM 解析库，浏览器同构已被 src/lib/plan-inspector 生产验证；白名单在 architecture.md 显式化（{P3}），不再悄悄扩' }}),
  px({ id:'R2', label:'R2', kind:'risk', title:'8 节抽取泛化质量未知',
    ui:{ lvl:'中', short:'8 节抽取泛化质量未知',
      risk:'8 节抽取的泛化质量未知——标杆样本只有 1 份，规则可能 over-fit（know：N=1 不足以声明 feasibility）',
      fix:'{§4.6} 强制 ≥3 个不同形态 fixture（含退化样本）；解析全程降级不 throw；后续真实文档暴露的缺陷按 fixture 补 case' }}),
  px({ id:'R3', label:'R3', kind:'risk', title:'迁移期 rewrite 无服务端拦截',
    ui:{ lvl:'低', short:'迁移期 rewrite 无服务端拦截',
      risk:'砍服务端 decided 过滤后，迁移期直连 API 的 rewrite 无拦截（{D3} 显式接受的代价）',
      fix:'旧前端本就不提交 decided 项，可见行为几乎不变；grounding（{D4} 起步）是替代防线的正路' }}),
  px({ id:'R4', label:'R4', kind:'risk', title:'双模型并存概念混淆',
    ui:{ lvl:'低', short:'双模型并存概念混淆',
      risk:'双模型并存期两套抽取结果并存（旧 5 类面板 vs 新 8 类 API），概念上易混淆',
      fix:'消费方天然隔离（旧前端 vs 新前端 / 集成方）；随旧路径退休（{Q3}）自然消解，不做双向同步' }}),
  px({ id:'R5', label:'R5', kind:'risk', title:'legacy shim 成为永久遗留',
    ui:{ lvl:'中', short:'legacy shim 成为永久遗留',
      risk:'legacy planState shim 成为永久遗留（退休条款不执行则长期背两套持久化语义）',
      fix:'shim 文件头 HACK(delete with old-path retirement, {Q3}) 标注；退休触发条件在 {Q3} 显式挂钩新前端落地' }}),

  /* ── §7 前置（ui.blocks/short）── */
  px({ id:'P1', label:'P1', kind:'precondition', title:'8 类信息点体系 = 新模型 v1',
    ui:{ blocks:'§4.1', short:'8 类信息点体系 = 新模型 v1' },
    text:'确认 8 类信息点体系（goal / scope / decision / behavior / verification / risk / precondition / open-question）为新模型 v1 形态——即「7 类 InfoKind + precondition」，不再另起分类法' }),
  px({ id:'P2', label:'P2', kind:'precondition', title:'Strangler 并存细节与退休条款',
    ui:{ blocks:'§4.4', short:'Strangler 并存细节与退休条款' },
    text:'确认 Strangler 并存细节——旧锁 UI 与 /api/plan-state 迁移期保持原行为（经 legacy shim），退休时点挂新前端切换（{Q3}）' }),
  px({ id:'P3', label:'P3', kind:'precondition', title:'E0 依赖白名单扩 mdast',
    ui:{ blocks:'§4.2', short:'E0 依赖白名单扩 mdast' },
    text:'确认 E0 依赖白名单扩为 types/ + zod + mdast 解析库（mdast-util-from-markdown / mdast-util-gfm / micromark-extension-gfm），docs/architecture.md 措辞随之更新（lint 为黑名单制，无需改规则）' }),
  px({ id:'P4', label:'P4', kind:'precondition', title:'新前端消费面 = GET /api/extract',
    ui:{ blocks:'§4.5', short:'新前端消费面 = GET /api/extract' },
    text:'确认 Claude Design 新前端消费面就是 GET /api/extract + 现有 annotations / rewrite / file 契约；对齐前 types/api.ts 新增形状不定稿' }),

  /* ── §8 待确认（ui.owner/blocks/due/short）── */
  px({ id:'Q1', label:'Q1', kind:'open-question', title:'旧 planState 数据弃或留档',
    ui:{ owner:'产品', blocks:'退休条款执行', due:'旧路径退休前', short:'旧 planState 数据弃或留档' },
    text:'旧 planState 历史数据在旧路径退休时直接弃，还是导出留档' }),
  px({ id:'Q2', label:'Q2', kind:'open-question', title:'价值度 / 置信度产出逻辑',
    ui:{ owner:'产品', blocks:'v-next 立项', due:'无', short:'价值度 / 置信度产出逻辑' },
    text:'价值度 / 置信度（source / confidence 字段位）的产出逻辑与排期（⚠ TBD by design，本期只留字段位）' }),
  px({ id:'Q3', label:'Q3', kind:'open-question', title:'旧路径退休时点',
    ui:{ owner:'产品+AI', blocks:'{R5}、{§2} 「不删旧路径」的解除', due:'新前端接上后', short:'旧路径退休时点' },
    text:'旧路径退休时点与 e2e 迁移排期——依赖 Claude Design 新前端落地；退休 checklist：删 plan-inspector.ts / 锁 UI / /api/plan-state / legacy shim / decided 相关 e2e' }),
  px({ id:'Q4', label:'Q4', kind:'open-question', title:'类型居所与命名',
    ui:{ owner:'产品', blocks:'{§4.1} 命名定稿（不卡实现）', due:'§4.1 code review 前', short:'类型居所与命名' },
    text:'新模型类型的最终居所与命名：默认按 types/domain.ts 原地演进开工；是否拆独立文件、ExtractedItem 是否更名（如 InfoPoint）在 review 时定' }),
  px({ id:'Q5', label:'Q5', kind:'open-question', title:'决策卡三段引导词表',
    ui:{ owner:'产品', blocks:'decisions.ts 词表', due:'§4.2 开发中（先按固定词表 + 降级实现）', short:'决策卡三段引导词表' },
    text:'决策卡三段引导词表是否固定为「选了什么 / 为什么 / 否掉了谁」，还是开放别名' }),
];

/* ═══ extract.decisions ═══ */
const DECISIONS_FIXTURE = [
  { pointId:'D1', label:'D1', status:'decided', core:true,
    question:'三套模型怎么收敛', pick:'Strangler 分层收敛（新旧并存）', title:'三套模型收敛：Strangler 分层收敛（新旧并存）',
    chosen:'新数据层（新 types + core/extract）加在旁边；现有前端、plan-inspector.ts、/api/plan-state 旧路径不动。新前端接上新模型后再按退休条款删旧路径。（并存细节见 {P2}）',
    rationale:'{G1}——旧模型在 src/ 约 140 处标识符引用、4 个 e2e spec 断言其行为，原地拆换当场编译失败 + e2e 全红，迁移期 app 不可用；{G4}——旧路径不动即不回归；新前端产出时机不受本期控制（{P4}），并存是唯一让两侧都不阻塞的方式。',
    rejected:[
      { option:'大爆炸原地拆换', reason:'违反 {G1}/{G4}：140 处前端引用 + e2e 断言当场全红，迁移期 app 不可用' },
      { option:'维持三套并行', reason:'现状即卡死：新前端无模型可接，{B1}/{B2} 两个 bug 永久悬置' },
    ]},
  { pointId:'D2', label:'D2', status:'decided',
    question:'抽取逻辑放哪', pick:'从前端移入 core/extract', title:'抽取逻辑从前端移入 core/extract',
    chosen:'plan-inspector.ts 的 mdast 解析迁入 core/extract/，扩到 8 节 + 决策卡 + GFM 表格。core 无框架、浏览器可同构（mdast 系解析库已在前端生产运行），前端将来可直接 import，不伤编辑体验。（E0 白名单扩展见 {P3}）',
    rationale:'六边形架构下领域逻辑归 core——集成路线（PM 项目 import core）拿不到留在 src/ 的抽取；新 API（{§4.5}）也需要服务端跑同一份解析。',
    facts:'ESLint E0 是黑名单制（禁 hono / react / execa / server / src / adapters），mdast-util-from-markdown 不在禁止列表，lint 无需改；需改 docs/architecture.md 的白名单措辞（{P3}）。需新增 devDeps→deps：mdast-util-gfm + micromark-extension-gfm（标杆文档的约束 / 风险 / 待确认全是 GFM 表格，现有 fromMarkdown 裸调不解析表格）。',
    rejected:[
      { option:'留在前端 src/lib', reason:'违背六边形依赖规则；seam 集成方与服务端 API 都拿不到抽取' },
      { option:'markdown parser 做成注入端口', reason:'单实现抽象（arch-design §2）；mdast 库本身无框架、同构，无注入必要' },
    ]},
  { pointId:'D3', label:'D3', status:'decided',
    question:'锁 / 防漂移怎么处理', pick:'砍掉整条线', title:'砍掉「锁 / 防漂移」整条线',
    chosen:'新模型不带锁概念；同时摘除三处存量：(a) ConfirmState 死 seam 全链删除；(b) ReviewState 端口去 planState（旧锁持久化改走显式 legacy shim，行为不变，随旧路径退休删除）；(c) core/rewrite.ts 的 decided 过滤删除。',
    rationale:'产品负责人 dogfood 已验证锁没必要——只要改写足够准（grounding 方向，{D4}），就不需要冻结文字。{B1}/{B2} 两个漂移 bug 随功能消失，不需单独修补；ConfirmState 有存储无 producer / consumer，纯负债。',
    cost:'(c) 删除后，迁移期内直连 POST /api/rewrite 提交 decided id 不再被服务端拦截（旧前端 Sidebar 本就不提交 decided 项，用户可见行为几乎不变）；decided.spec.ts 的「server blocks rewrite」断言随功能同步删——砍功能的配套调整，不算 {G4} 回归。此代价为显式接受。',
    rejected:[
      { option:'修 B1/B2 保留锁', reason:'在已决定砍掉的功能上返工；B1 修复还要把 planState 接进 rewrite 链路，是反方向投入' },
      { option:'锁线保留到旧路径退休再砍', reason:'ConfirmState 零消费无保留价值；rewrite 过滤留着就得继续背 {B1}/{B2} 的「假保护」语义' },
    ]},
  { pointId:'D4', label:'D4', status:'decided',
    question:'grounding 地基怎么打', pick:'标签 + 交叉引用轻量实现', title:'grounding 地基：标签 + 交叉引用 轻量实现',
    chosen:'信息点带稳定标签（G1 / D2 / R3 / P1 / Q4，pattern ^[GDRPQ]\\d+$），从标题前缀 / 表格首列 / 列表加粗前缀识别；各点正文扫描引用得 refs（引用即「依据」）；core 提供纯函数把引用解析成可导航关系（上下文包雏形）。有标签的点 id = label（重排不换 id），无标签回退现有结构 id 算法。',
    rationale:'改写要准就得先让「依据」可机读；标签 + 引用是最小可用的 grounding 结构，plan-auth-soc2.md 已验证这种写法可读可写。',
    rejected:[
      { option:'本期上 AI 抽取 / 语义 grounding', reason:'未验证、工程量大；违背「先规则化」的范围外约定，留 source: "ai" 字段位即可（{Q2}）' },
      { option:'ContextPack（itemIds 列表）照旧实现', reason:'静态 id 列表是 refs 图的降级形态；被 D4 的引用图取代，类型一并删除' },
    ]},
];

/* ═══ 离线 / dev fallback 源 ═══
   live fetch（plan-app bootstrap）失败时用它 buildPlanModel。此文件不再构建
   PLAN_MODEL、也不占用全局 PLAN_MODEL —— 全局 PLAN_MODEL 由 plan-app 从真实
   GET /api/sessions/:id/extract 经 adaptExtract 派生后写入（live 优先，单一来源，
   fixture 只在离线兜底时启用，避免 live 与 fixture 双源冲突）。 */
const PLAN_FALLBACK_SOURCE = {
  meta: PLAN_META,
  sections: PLAN_SECTIONS,
  extract: { points: POINTS_FIXTURE, decisions: DECISIONS_FIXTURE },
};

Object.assign(window,{ PLAN_FALLBACK_SOURCE });

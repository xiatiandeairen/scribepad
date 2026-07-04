/* ═══ Spec Plan — 演示数据（会话 / 批注 / 历史 / 命令）═══
   全部为 mock 演示内容，接真实后端时由 API 数据替换：
   · 会话 / 消息   → 你的会话存储
   · 批注 NOTES0   → GET /api/annotations
   · 历史 HIST0    → 你的版本记录
   · NOTE_ANCHORS  → 批注 anchor（label → 原文锚点子串） */

/* ── 初始会话 ── */
const CHAT = [
  { role:'user', text:'把「plan 场景数据后端」的讨论收敛成一份标准 8 节 plan，决策要给出候选对比，结论都要能溯源。' },
  { role:'ai', body:[
      '已按固定 8 节模型生成 plan《数据后端落地：三模型收敛 + core 抽取》。读仓库核实了三套模型的渗透面（src/ 约 140 处标识符），并确认了锁线上的 2 个真 bug（B1 / B2）。',
      '4 个决策（D1–D4）都给了候选对比与被否理由；全部信息点带稳定标签，正文引用即依据——点文中任意标签可核对它的引用链。'
    ],
    acts:[
      { icon:'edit', kind:'edit',   title:'生成 8 节 plan',       sub:'目标 · 边界 · 决策 · 做法 · 验收 · 风险 · 前置 · 待确认', sec:'goal' },
      { icon:'link', kind:'canvas', title:'建立标签引用图',       sub:'25 个稳定标签 · 出边 / 入边可导航', sec:'dec' },
      { icon:'warn', kind:'chart',  title:'标记 4 个待拍板前置',  sub:'P1–P4 · 不拍板对应步骤不开工', sec:'pre' },
    ]},
  { role:'user', text:'锁那条线为什么敢直接砍？依据是什么。' },
  { role:'ai', body:[
      '依据链是 D3 → B1 / B2 + dogfood 结论：锁的保护从未真正生效（B1），且重新划选即可绕过（B2）；产品负责人 dogfood 验证「改写足够准就不需要冻结文字」。代价在 R3 显式接受——旧前端本就不提交 decided 项，用户可见行为几乎不变。'
    ],
    acts:[{ icon:'check', kind:'edit', title:'定位 D3 决策卡', sub:'含 2 个被否候选与显式代价', pt:'D3' }]},
];
const s2msgs = [
  { role:'user', text:'plan-auth-soc2 那份标杆 plan，抽取器要覆盖到什么程度？' },
  { role:'ai', body:['全部 8 节 + 3 张决策卡三段 + 标签交叉引用，量化断言都写进了 G3 与 §5 验收：G1–G4 约束点、R1–R5、P1–P4、Q1–Q5 数量与标签逐一正确，验收节 9 个 checkbox 点 ≥7 个 refs 命中。'] },
];
const s3msgs = [
  { role:'user', text:'新前端到底消费哪几个接口？' },
  { role:'ai', body:['定稿为 GET /api/extract + 现有 /api/annotations、/api/rewrite、/api/file，四个契约 P4 对齐后不再动形状。旧的 /api/plan-state 已标 @deprecated，随旧路径退休删除（Q3）。'] },
];
const SESSIONS = [
  { id:'s1', title:'数据后端 plan · 三模型收敛', time:'进行中',    msgs:CHAT, active:true },
  { id:'s2', title:'plan-auth-soc2 标杆复盘',   time:'昨天 16:02', msgs:s2msgs },
  { id:'s3', title:'新前端消费面对齐',          time:'3 天前',     msgs:s3msgs },
];

/* ── 空态建议 / 选区更多操作 / 命令面板 ── */
const SUGG = [
  { icon:'check', text:'评审这份 plan 的风险与漏洞' },
  { icon:'link',  text:'检查有没有悬空引用' },
  { icon:'edit',  text:'把 Q5 的词表方案展开成对比' },
];
const SEL_MORE = [
  { id:'dcard',   icon:'table', label:'转为决策卡', k:'⌘D' },
  { id:'risk',    icon:'warn',  label:'提为风险项', k:'⌘R' },
  { id:'open',    icon:'note',  label:'提为待确认', k:'⌘U' },
  { id:'explain', icon:'info',  label:'解释这段',   k:'⌘/' },
];
const CMDS = [
  { grp:'AI 操作', items:[
    { id:'ai-review', icon:'check', title:'评审这份 plan',   sub:'检查决策自洽性与 fixture 覆盖' },
    { id:'ai-refs',   icon:'link',  title:'检查悬空引用',     sub:'扫描标签引用图' },
  ]},
  { grp:'定位', items:[
    { id:'go-dec', icon:'sparkF', title:'跳到 §3 决策', sub:'D1–D4 · 核心决策', sec:'dec' },
    { id:'go-pre', icon:'warn',   title:'跳到 §7 前置', sub:'P1–P4 · 等你拍板', sec:'pre' },
    { id:'go-acc', icon:'check',  title:'跳到 §5 验收', sub:'9 条可判定断言',   sec:'acc' },
  ]},
];

/* ── 批注（评审意见）+ 原文锚点 ── */
const NOTES0 = [
  { id:'n1', who:'周衍', color:'#7a6ad0', time:'40 分钟前', pt:'D3', quote:'砍掉「锁 / 防漂移」整条线', body:'D3 的代价（R3）我认可，但退休前这段迁移期建议在 /api/rewrite 留一条日志埋点，方便观察是否真有人直连提交 decided。不阻塞开工。', status:'open' },
  { id:'n2', who:'陈默', color:'#c98a2b', time:'1 小时前', pt:'R2', quote:'标杆样本只有 1 份，规则可能 over-fit', body:'R2 是本期最大的不确定性。§4.6 的 4 个 fixture 全是中文 8 节，建议补一个英文 plan 和一个「决策三段词表变体」的样本，把降级路径也压到。', status:'open' },
  { id:'n3', who:'林越', color:'#3d9a6d', time:'昨天', pt:'P1', quote:'8 类信息点体系为新模型 v1 形态', body:'P1 我这边拍板了：precondition 作为第 8 类没问题，和 8 节一一对应清晰。', status:'done' },
];
/* label → 原文中被高亮的锚点子串（渲染层 AnnoText 消费） */
const NOTE_ANCHORS = {
  D3:{ id:'n1', anchorText:'砍掉整条线' },
  R2:{ id:'n2', anchorText:'标杆样本只有 1 份，规则可能 over-fit' },
  P1:{ id:'n3', anchorText:'8 类信息点体系（goal / scope / decision / behavior / verification / risk / precondition / open-question）为新模型 v1 形态' },
};

/* ── 修改历史 ── */
const HIST0 = [
  { id:'h1', who:'user', icon:'edit',  sec:'pre',  desc:['周衍 拍板了','前置 P1'], time:'刚刚',
    diff:{ kind:'add', summary:'P1（8 类信息点体系 = 新模型 v1）已拍板 —— §4.1 类型步骤解锁，可开工。' } },
  { id:'h2', who:'ai',   icon:'link',  sec:'dec',  desc:['建立','标签引用图'], time:'1 小时前',
    diff:{ kind:'add', summary:'为 25 个稳定标签（G/D/R/P/Q/B）扫描出交叉引用，生成出边 / 入边可导航的引用图 —— D4 grounding 地基的雏形。' } },
  { id:'h3', who:'ai',   icon:'table', sec:'dec',  desc:['「方案」重构为','4 张决策卡'], time:'2 小时前',
    diff:{ kind:'text', before:'用一段文字描述了三套模型收敛、抽取下沉、砍锁、grounding 四个取舍，结论散在正文里。', after:'把四个取舍重构为 D1–D4 决策卡：每张含「选了什么 / 为什么 / 否掉了谁」三段 + 被否候选对比表 + ✅ 已定状态。' } },
  { id:'h4', who:'ai',   icon:'edit',  sec:'goal', desc:['生成','8 节 plan 初稿'], time:'2 小时前',
    diff:{ kind:'add', summary:'从讨论记录与仓库核实生成标准 8 节 plan：目标 / 边界 / 决策 / 做法 / 验收 / 风险 / 前置 / 待确认。' } },
];

Object.assign(window,{ CHAT, SESSIONS, SUGG, SEL_MORE, CMDS, NOTES0, NOTE_ANCHORS, HIST0 });

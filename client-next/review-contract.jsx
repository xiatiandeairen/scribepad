/* ═══════════════════════════════════════════════════════════════════
   Spec Plan — 数据契约层（contract）
   ═══════════════════════════════════════════════════════════════════
   本文件是「后端 ⇄ 前端」的唯一对接点，与后端 types/api.ts 的
   GET /api/sessions/:id/extract → ExtractResult { points, decisions, meta } 对齐。

   ┌─ 契约字段（后端原生，勿改名）──────────────────────────────┐
   │ ExtractedItem:                                              │
   │   id          string   — label ?? 结构 id（重排不换 id）     │
   │   kind        InfoKind — 8 类，与 8 节一一对应               │
   │   label?      string   — 稳定标签 ^[GDRPQB]\d+$（B=目标节bug）│
   │   refs        string[] — 正文引用的标签（可悬空）            │
   │   text        string   — 点的正文（可含 {标签} token）       │
   │   source      'rule'|'ai'                                   │
   │   confidence? number   — 字段位，本期不产出                  │
   │   anchor?     object   — 原文锚点，UI 暂不消费               │
   │ DecisionCard:                                               │
   │   pointId / label? / chosen / rationale /                   │
   │   rejected[{option,reason}] / status('decided'|'pending')   │
   └────────────────────────────────────────────────────────────┘

   ┌─ UI 扩展字段（adapter 填充，后端格式细化时只改这里）────────┐
   │ point.title / point.role / point.ui{…}  — 各节专用展示数据   │
   │ decision.question / pick / facts / cost / core              │
   │ UI 伪标签：S\d+（做法步骤）、A\d+（验收）、§1…§8（章节）      │
   │            — 仅前端导航用，非后端 label（B 是后端目标节标签）  │
   └────────────────────────────────────────────────────────────┘

   消费方式（唯一路径，见 review-net.jsx）：
   GET /api/sessions/:id/extract → adaptExtract() → buildReviewModel() → REVIEW_MODEL。
   运行边界见 docs/design/architecture.md。 */

/* ── 8 类信息点 ↔ 8 节：顺序即文档顺序 ── */
const SECTION_DEFS = [
  { id:'goal',  n:'1', name:'目标',   kind:'goal',          pseudo:'GOAL',  desc:'为什么做 · 以什么为准' },
  { id:'scope', n:'2', name:'边界',   kind:'scope',         pseudo:'SCOPE', desc:'范围内 / 范围外' },
  { id:'dec',   n:'3', name:'决策',   kind:'decision',      pseudo:'DEC',   desc:'选了什么 · 为什么 · 否掉了谁', core:true },
  { id:'how',   n:'4', name:'做法',   kind:'behavior',      pseudo:'HOW',   desc:'按序执行 · 每步一个 commit' },
  { id:'acc',   n:'5', name:'验收',   kind:'verification',  pseudo:'ACC',   desc:'全部可勾选 · 逐条挂约束' },
  { id:'risk',  n:'6', name:'风险',   kind:'risk',          pseudo:'RISK',  desc:'影响 + 缓解' },
  { id:'pre',   n:'7', name:'前置',   kind:'precondition',  pseudo:'PRE',   desc:'不拍板不开工' },
  { id:'open',  n:'8', name:'待确认', kind:'open-question', pseudo:'OPEN',  desc:'不卡开工 · 各卡一环' },
];
const KIND_TO_SEC = Object.fromEntries(SECTION_DEFS.map(s=>[s.kind, s.id]));

/* ── 标签体系：前缀 → 语义（芯片配色 / 悬停预览 / 图例共用）── */
const LABEL_KINDS = {
  G:{ kind:'gate', name:'硬约束',    cls:'g' },
  D:{ kind:'dec',  name:'决策',      cls:'d' },
  R:{ kind:'risk', name:'风险',      cls:'r' },
  P:{ kind:'pre',  name:'前置拍板',  cls:'p' },
  Q:{ kind:'open', name:'待确认',    cls:'q' },
  B:{ kind:'bug',  name:'已核实 bug', cls:'b' },
  A:{ kind:'acc',  name:'验收项',    cls:'s' },
  S:{ kind:'sec',  name:'章节',      cls:'s' },
};
const KIND_META = {
  gate:{ name:'硬约束',    cls:'g' }, dec: { name:'决策',   cls:'d' },
  risk:{ name:'风险',      cls:'r' }, pre: { name:'前置拍板', cls:'p' },
  open:{ name:'待确认',    cls:'q' }, bug: { name:'已核实 bug', cls:'b' },
  acc: { name:'验收项',    cls:'s' }, sec: { name:'章节',   cls:'s' },
};

/* ── token 归一化：正文里的 {§4.2} / {§1} → 注册表 key ── */
function normLabel(l){
  const m=/^§4\.(\d)/.exec(l); if(m) return 'S'+m[1];
  const n=/^§(\d)$/.exec(l);
  if(n){ const s=SECTION_DEFS[+n[1]-1]; return s?s.pseudo:l; }
  return l;
}

/* ── {token} 扫描：任意字符串 → 引用到的注册表 key 列表 ── */
function scanRefTokens(str){
  const out=[];
  String(str||'').replace(/\{([^}]+)\}/g,(_,l)=>{ const k=normLabel(l); if(!out.includes(k)) out.push(k); return ''; });
  return out;
}
/* 递归收集一个数据对象里所有字符串字段的 token（refs 派生用） */
function deepScanRefs(val, out){
  out=out||[];
  if(typeof val==='string'){ scanRefTokens(val).forEach(k=>{ if(!out.includes(k)) out.push(k); }); }
  else if(Array.isArray(val)) val.forEach(v=>deepScanRefs(v,out));
  else if(val&&typeof val==='object') Object.values(val).forEach(v=>deepScanRefs(v,out));
  return out;
}
const stripTokens=(s)=>String(s||'').replace(/[{}]/g,'');

/* ── 各类点的悬停预览摘要（brief）提取器 ── */
const BRIEF_OF = {
  gate:(p)=>stripTokens(p.text),
  bug: (p)=>stripTokens(p.text),
  risk:(p)=>stripTokens(p.ui.risk)+'。缓解：'+stripTokens(p.ui.fix),
  pre: (p)=>stripTokens(p.text),
  open:(p)=>stripTokens(p.text),
  acc: (p)=>stripTokens(p.text),
  sec: (p)=>stripTokens(p.text),
  dec: (p)=>stripTokens(p.text),
};

/* ═══ buildReviewModel(source) → 视图模型 ═══
   source = { meta, sections:[{id,kicker,lead?,extras?}], extract:{points,decisions} }
   返回 { meta, sections, points(注册表), inbound(入边), legend, byKind, decisions }
   —— 展示字段全部从后端抽取结果派生。 */
function buildReviewModel(source){
  const { meta, extract } = source;
  const secOverride = Object.fromEntries((source.sections||[]).map(s=>[s.id,s]));

  /* 1) 点注册表：契约点 + 决策卡点 + 章节伪点 */
  const points={};
  const put=(key,entry)=>{ points[key]={ refs:[], ...entry }; };

  extract.points.forEach(p=>{
    const role=p.role||'point';
    const kindKey = p.label ? (LABEL_KINDS[p.label[0]]||{}).kind||'sec' : null;
    if(!p.label) return;                       /* 无标签点不进导航注册表 */
    put(p.label,{
      kind:kindKey, sec:KIND_TO_SEC[p.kind], role,
      title:p.title||stripTokens(p.text).slice(0,40),
      brief:(BRIEF_OF[kindKey]||BRIEF_OF.sec)(p),
      lvl:p.ui&&p.ui.lvl, point:p,
      refs:[...new Set([...(p.refs||[]), ...deepScanRefs(p)])].filter(k=>k!==p.label),
    });
  });

  extract.decisions.forEach(d=>{
    put(d.label||d.pointId,{
      kind:'dec', sec:'dec', role:'decision',
      title:d.title||stripTokens(d.chosen).slice(0,40),
      brief:stripTokens(d.chosen), decision:d,
      refs:deepScanRefs(d).filter(k=>k!==(d.label||d.pointId)),
    });
  });

  SECTION_DEFS.forEach(s=>{
    const ov=secOverride[s.id]||{};
    put(s.pseudo,{ kind:'sec', sec:s.id, role:'section', chip:'§'+s.n,
      title:`§${s.n} ${s.name}`, brief:ov.brief||s.desc, refs:[] });
  });
  /* 做法步骤伪点 §4.n（供 {§4.2} 引用）*/
  extract.points.filter(p=>p.kind==='behavior').forEach(p=>{
    const e=points[p.label]; if(!e) return;
    e.chip='§4.'+p.ui.num;
    e.title=`§4.${p.ui.num} 做法 · ${p.title}`;
    e.brief=stripTokens(p.ui.file||p.text);
  });
  /* 验收伪点 A1…（右栏依据链引用）*/
  extract.points.filter(p=>p.kind==='verification').forEach((p,i)=>{
    const e=points[p.label]; if(e){ e.chip='验收'+(i+1); e.title='验收 · 第 '+(i+1)+' 条'; }
  });

  /* 2) 引用图入边（谁引用了我） */
  const inbound={};
  Object.entries(points).forEach(([from,e])=>{
    e.refs.forEach(to=>{ (inbound[to]=inbound[to]||[]).push(from); });
  });

  /* 3) 分节视图：每节的点 + 徽标 */
  const byKind={};
  extract.points.forEach(p=>{ (byKind[p.kind]=byKind[p.kind]||[]).push(p); });
  /* 每节都有数组：某 kind 无点时右栏 / 徽标裸 .filter 不崩（任意文档不白屏）*/
  SECTION_DEFS.forEach(s=>{ byKind[s.kind]=byKind[s.kind]||[]; });

  const badge=(s)=>{
    const ps=byKind[s.kind]||[];
    switch(s.id){
      case 'goal':  return ps.filter(p=>p.role==='gate').length+' 约束';
      case 'scope': return ps.filter(p=>p.role==='out').length+' 不做';
      case 'dec':   return extract.decisions.filter(d=>d.status==='decided').length+' 已定';
      case 'how':   return ps.length+' 步';
      case 'acc':   return ps.length+' 项';
      case 'risk':  return ps.filter(p=>p.ui.lvl==='中').length+' 中';
      case 'pre':   return ps.length+' 拍板';
      case 'open':  return ps.length+' 问';
      default:      return ps.length+'';
    }
  };
  const sections=SECTION_DEFS.map(s=>({ ...s, ...(secOverride[s.id]||{}), badge:badge(s) }));

  /* 4) 图例（左右栏共用的标签体系说明） */
  const count=(pred)=>extract.points.filter(pred).length;
  const legend=[
    { cls:'g', k:'G', name:'硬约束',   n:count(p=>p.role==='gate'), sec:'goal' },
    { cls:'d', k:'D', name:'决策',     n:extract.decisions.length,  sec:'dec'  },
    { cls:'r', k:'R', name:'风险',     n:count(p=>p.kind==='risk'), sec:'risk' },
    { cls:'p', k:'P', name:'前置拍板', n:count(p=>p.kind==='precondition'), sec:'pre'  },
    { cls:'q', k:'Q', name:'待确认',   n:count(p=>p.kind==='open-question'), sec:'open' },
    { cls:'b', k:'B', name:'已核实 bug', n:count(p=>p.role==='bug'), sec:'goal' },
  ];

  return { meta, sections, points, inbound, legend, byKind, decisions:extract.decisions };
}

/* ═══ adaptExtract：后端结构事实 → 前端 ViewModel（DTO 第三层派生）═══
   D-1：后端只忠实抽取「结构事实」（cells 表头×单元格 / group 分组 / label / text
   / 决策卡 heading 结构 / doc-level meta），零 UI 语义。此层按各节渲染器
   （review-sections.jsx）实际消费的 point.role / point.ui.* / decision.* 字段做派生，
   让任意规范书写的 8 节 plan.md 无需 per-doc overlay 即渲染。
   降级铁律：表头缺失 / 列缺失 / 无匹配时 ui 字段留空，渲染器 guard 或显示空，绝不 throw；
   每个 point 注入 ui:{} 默认——buildReviewModel 的徽标码裸访问 p.ui.lvl 等，缺则崩。 */

/* GFM 表格行按表头名取单元格文本；表头用「包含」匹配容忍前后缀，缺失返回 ''。 */
function cellOf(cells,name){
  const arr=cells||[];
  const hit=arr.find(c=>c.header===name)||arr.find(c=>String(c.header).indexOf(name)>=0);
  return hit?hit.text:'';
}

/* 目标节：G→gate（cells[约束]=标题、cells[可判定标准]=正文），B→bug（拆首句为标题、余下为正文）。
   无标签点（引导段 / 模型对照表行）role 不变，GoalSection 只按 role 过滤显示 gate/bug，其余不渲染。 */
function deriveGoalPoint(p){
  const pre=p.label?p.label[0]:'';
  if(pre==='G') return { ...p, role:'gate', ui:{ ...p.ui },
    title:cellOf(p.cells,'约束')||p.title, text:cellOf(p.cells,'可判定标准')||p.text };
  if(pre==='B'){
    const body=String(p.text||'').replace(/^B\d+[：:\s]*/,'').trim();
    const m=/^(.+?)[；。]([\s\S]+)$/.exec(body);
    return { ...p, role:'bug', ui:{ ...p.ui }, title:m?m[1].trim():body, text:m?m[2].trim():'' };
  }
  return { ...p, ui:{ ...p.ui } };
}

/* 边界节：group 含「范围内」→in、「范围外/non-goal」→out；out 点「不做 前端——正文」拆出 ui.verb/rest。 */
function deriveScopePoint(p){
  const g=p.group||'';
  const role=/范围外|non-?goal/i.test(g)?'out':/范围内/.test(g)?'in':(p.role||'point');
  if(role==='out'){
    const m=/^(\S+)\s+([^—]+?)——([\s\S]*)$/.exec(String(p.text||''));
    return { ...p, role, ui:{ ...p.ui, verb:m?m[1]:'', rest:m?m[2].trim():'' }, text:m?m[3].trim():p.text };
  }
  return { ...p, role, ui:{ ...p.ui } };
}

/* 风险节：cells[风险/影响/缓解] → ui.risk/lvl/fix。 */
function deriveRiskPoint(p){
  return { ...p, role:'risk',
    ui:{ ...p.ui, risk:cellOf(p.cells,'风险')||p.text, lvl:cellOf(p.cells,'影响'), fix:cellOf(p.cells,'缓解') },
    title:cellOf(p.cells,'风险')||p.title };
}

/* 前置节：正文 '（卡 §4.x）' → ui.blocks；剥前缀 'P1（卡 …）：' 留纯正文。 */
function derivePrePoint(p){
  const blocks=(/（卡\s*(§?[\d.]+)/.exec(String(p.text||''))||[])[1]||'';
  const text=String(p.text||'').replace(/^P\d+（[^）]*）[：:\s]*/,'').trim();
  return { ...p, role:'pre', ui:{ ...p.ui, blocks }, text:text||p.text };
}

/* 待确认节：cells[owner/卡什么/截止] → ui.owner/blocks/due；cells[问题] → 正文。 */
function deriveOpenPoint(p){
  const q=cellOf(p.cells,'问题');
  return { ...p, role:'open',
    ui:{ ...p.ui, owner:cellOf(p.cells,'owner'), due:cellOf(p.cells,'截止'), blocks:cellOf(p.cells,'卡什么') },
    title:q||p.title, text:q||p.text };
}

/* 做法节：checkpoint 带后端 ordinal（有序列表项序号 / H3「N.」序号）→ step（ui.num=ordinal）；
   两种写法（GFM 有序列表 / H3「### N.」）统一走 ordinal 一条路，不再靠脆弱的字面 N. 前缀识别。
   title 从「标题（file）」取 file，无括号时整段作 title；H3 文本残留的 N. 前缀顺带剥掉。
   detail 按 group 折进父步骤 ui.pts。富块（模块结构树 tree / 子 commit subs）本期不派生（D-1 富块 v2）。 */
function deriveBehaviorSteps(points){
  const steps=[];
  (points||[]).forEach(p=>{
    if(p.role!=='checkpoint'||p.ordinal==null) return;
    const rest=String(p.text||'').trim().replace(/^\d+\.\s*/,'').trim();
    const fm=/^(.+?)（([\s\S]+)）\s*$/.exec(rest);
    steps.push({ ...p, role:'step', title:fm?fm[1].trim():rest,
      ui:{ ...p.ui, num:String(p.ordinal), file:fm?fm[2].trim():'', pts:[] } });
  });
  (points||[]).forEach(p=>{
    if(p.role!=='detail'||!p.group) return;
    const parent=steps.find(s=>s.text===p.group);
    if(parent) parent.ui.pts.push(p.text);
  });
  return steps;
}

/* 验收节：无 label，注入伪标签 A1…（前端导航用）；剥正文首个引用前缀（与右侧 Ref 芯片去重）。 */
function deriveVerificationPoints(points){
  return (points||[]).map((p,i)=>({ ...p, role:'acc', label:'A'+(i+1), ui:{ ...p.ui },
    text:String(p.text||'').replace(/^(§?[GDRPQ][\d.]*)\s+/,'') }));
}

/* doc-level meta（H1 + 引导 blockquote 原文）→ REVIEW_META；intro 按 '|' 拆出 status/branch。 */
function deriveReviewMeta(apiMeta,docMeta){
  const meta=apiMeta||{}, dm=docMeta||{};
  const segs=String(meta.intro||'').split('|').map(s=>s.trim()).filter(Boolean);
  const seg=(k)=>{ const h=segs.find(s=>s.indexOf(k)===0); const i=h?h.search(/[：:]/):-1; return i>=0?h.slice(i+1).trim():''; };
  const rest=segs.filter(s=>!/^(状态|分支)/.test(s)).join(' · ');
  return {
    project:dm.project||'scribepad', file:dm.file||'',
    title:meta.title||dm.file||'', status:seg('状态')||'待 review', branch:seg('分支')||'',
    fixture:rest||meta.title||'', tldr:rest||meta.title||'',
  };
}

/* ExtractResult → REVIEW_SOURCE。uiOverlay 可选（后端格式细化时 per-doc 兜底覆盖，本期不用）。 */
function adaptExtract(apiResult,docMeta,uiOverlay){
  const isLead=(p)=>!p.label&&!(p.cells&&p.cells.length)&&/[:：]\s*$/.test(String(p.text||''));
  const byKind={};
  (apiResult.points||[]).filter(p=>!isLead(p)).forEach(p=>{ (byKind[p.kind]=byKind[p.kind]||[]).push(p); });

  const points=[]
    .concat((byKind.goal||[]).map(deriveGoalPoint))
    .concat((byKind.scope||[]).map(deriveScopePoint))
    .concat((byKind.decision||[]).map(p=>({ ...p, ui:{ ...p.ui } })))
    .concat(deriveBehaviorSteps(byKind.behavior||[]))
    .concat(deriveVerificationPoints(byKind.verification||[]))
    .concat((byKind.risk||[]).map(deriveRiskPoint))
    .concat((byKind.precondition||[]).map(derivePrePoint))
    .concat((byKind['open-question']||[]).map(deriveOpenPoint));

  /* 决策卡：pick/question/core/cost/facts 后端直接产出 → 基本透传；补 pick/title 兜底防裸渲染 undefined。 */
  const decisions=(apiResult.decisions||[]).map(d=>{
    const pick=d.pick||d.question||stripTokens(d.chosen).slice(0,40);
    return { ...d, ui:{ ...(d.ui||{}) }, pick, title:pick };
  });

  return {
    meta: deriveReviewMeta(apiResult.meta,docMeta),
    /* 节 kicker 用 SECTION_DEFS 静态默认（desc 作 kicker）；富块本期留空 → 通用渲染 */
    sections: (uiOverlay&&uiOverlay.sections)||SECTION_DEFS.map(s=>({ id:s.id, kicker:s.desc })),
    extract: { points, decisions },
  };
}

Object.assign(window,{ SECTION_DEFS, KIND_TO_SEC, LABEL_KINDS, KIND_META,
  normLabel, scanRefTokens, deepScanRefs, stripTokens, buildReviewModel, adaptExtract });

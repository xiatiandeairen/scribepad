/* ═══════════════════════════════════════════════════════════════════
   Review Doc — 数据契约层（contract）
   ═══════════════════════════════════════════════════════════════════
   本文件是「后端 ⇄ 前端」在「交付审阅报告」（docKind:'review'）场景下的唯一
   对接点。消费 ExtractResult{ points, decisions, meta, docKind, review }
   中的 review 段（types/domain.ts 的 ReviewExtract：verdicts / reconciliation /
   claims / leftovers / details），产出渲染层直接消费的 REPORT_MODEL。

   风格与职责对齐 review-contract.jsx（plan 文档的契约层）：纯函数、无
   fetch / DOM，公开符号统一挂到 window，供无构建步骤的 client-next 直接引用。

   ┌─ 消费方式 ──────────────────────────────────────────────────┐
   │ REPORT_MODEL = buildReportModel(extractResult, docMeta)      │
   │ docMeta = { project, file }（会话层已知，不在 ExtractResult 里）│
   │ parseReportMeta(intro) 单独导出：解析头部引导块引用             │
   │ （plan / commits / 日期 / 门禁 / 复核 / 建议路径），供独立测试。  │
   └────────────────────────────────────────────────────────────┘

   ┌─ 降级铁律 ────────────────────────────────────────────────────┐
   │ review 缺失 / 各数组缺失 → 全部按空数组处理，绝不 throw；        │
   │ intro 缺失 / 关键字缺失 → 对应 meta 字段回退 '' / null / []。   │
   └────────────────────────────────────────────────────────────┘ */

/* ── 裁决卡风险标签（VerdictCard.tag，标签集自由扩展）→ 芯片配色 class：
   不可逆/安全→r，对外行为→p，擅自决策→d，性能/流程→q，其余兜底 q。 ── */
function riskTagCls(tag) {
  const t = String(tag || '');
  if (/不可逆|安全/.test(t)) return 'r';
  if (/对外行为/.test(t)) return 'p';
  if (/擅自决策/.test(t)) return 'd';
  return 'q';
}

/* ── 对账行状态 → 中文标签；未知状态兜底 —（不崩渲染）。 ── */
const RECON_STATUS_LABEL = { done: '按计划', deviated: '有偏差', dropped: '未做', added: '新增' };
const statusLabelOf = (status) => RECON_STATUS_LABEL[status] || '—';

/* ── 遗留项类型 → 中文标签；未知类型兜底 —。 ── */
const LEFTOVER_KIND_LABEL = { deferred: '暂缓', assumption: '假设', limitation: '已知限制' };
const kindLabelOf = (kind) => LEFTOVER_KIND_LABEL[kind] || '—';

/* slice(0,n) 可能切在 UTF-16 代理对中间（高位在 n-1、低位在 n），留下孤立的高位
   代理——往回退一位，避免产出非法的半个代理对。与 review-net.jsx 的
   truncateAtCharBoundary 用同一手法（两文件各自 window 全局挂载，不跨文件
   import，故本地复一份 4 行纯函数而非跨文件引用）。 */
function truncateAtCharBoundary(str, max) {
  const code = str.charCodeAt(max - 1);
  const end = code >= 0xd800 && code <= 0xdbff ? max - 1 : max;
  return str.slice(0, end);
}
const truncate60 = (s) => truncateAtCharBoundary(String(s || ''), 60);

/* ── 头部引导块解析：plan/commits/日期/门禁/复核/建议路径 ──
   extractor 会把引导块的多行折叠成一个空白压缩后的字符串，因此不按行号定位，
   而是按关键字在文本中的出现位置切片：每个关键字的取值区间 = 它自身之后
   到「文本中下一个出现的关键字」之间（关键字按位置排序，而非固定顺序假设）。
   段尾残留的 `·` / `——` 分隔符（模版里 门禁——复核 同行相连）一并剥掉。
   任意关键字缺失 → 对应字段回退 '' / null / []，不抛错。 */
const REPORT_META_KEYS = ['plan:', 'commits:', '日期:', '门禁:', '复核:', '建议路径:'];

function parseReportMeta(intro) {
  const text = String(intro || '');
  const found = REPORT_META_KEYS.map((k) => ({ k, i: text.indexOf(k) }))
    .filter((x) => x.i >= 0)
    .sort((a, b) => a.i - b.i);

  const segOf = (key) => {
    const idx = found.findIndex((x) => x.k === key);
    if (idx < 0) return '';
    const start = found[idx].i + found[idx].k.length;
    const end = idx + 1 < found.length ? found[idx + 1].i : text.length;
    return text
      .slice(start, end)
      .trim()
      .replace(/(·|——)\s*$/, '')
      .trim();
  };

  const commitsSeg = segOf('commits:');
  const dateSeg = segOf('日期:');
  const gatesSeg = segOf('门禁:');
  const verifySeg = segOf('复核:');

  /* {3,40} — 6 起步会漏掉合法短哈希缩写（如本文件测试用到的 review-edge.md 头部
     的 aaa..bbb），导致 commits 回退成 '' 而 commitCount 仍正常解析，两个字段
     互相矛盾。3 是 git 缩写哈希的实用下限。 */
  const commitsMatch = /([0-9a-f]{3,40}\.\.[0-9a-f]{3,40})/.exec(commitsSeg);
  const countMatch = /（(\d+)\s*个）/.exec(commitsSeg);
  const dateMatch = /(\d{4}-\d{2}-\d{2})/.exec(dateSeg);
  /* extractor 的 compact() 会把 inline code 的反引号剥掉，因此反引号只是可选
     包裹：有则取包裹内内容，无则整段就是命令本身。 */
  const verifyMatch = /`([^`]+)`/.exec(verifySeg);

  const gates = gatesSeg
    ? gatesSeg
        .split('·')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((tok) => ({ name: tok.replace(/[✅❌]/g, '').trim(), ok: !/❌/.test(tok) && /✅/.test(tok) }))
        .filter((g) => g.name)
    : [];

  return {
    plan: segOf('plan:'),
    commits: commitsMatch ? commitsMatch[1] : '',
    commitCount: countMatch ? Number(countMatch[1]) : null,
    date: dateMatch ? dateMatch[1] : '',
    gates,
    verifyCmd: verifyMatch ? verifyMatch[1] : verifySeg,
    readingPath: segOf('建议路径:'),
  };
}

/* ── 点注册表条目：verdict / claim / leftover 三种来源统一形状，供
   review-app.jsx 的 pointEntryOf / pointAnchorOf 读取（点标注 / 签收共用）。 ── */
function putPoint(points, label, kind, sec, text, brief, anchor) {
  if (!label) return;
  points[label] = {
    kind,
    sec,
    role: 'checkpoint',
    title: text,
    brief: truncate60(brief),
    refs: [],
    point: { id: label, label, kind: 'review-unit', text, anchor },
  };
}

/* ═══ buildReportModel(extractResult, docMeta) → REPORT_MODEL ═══
   extractResult = ExtractResult{ meta?, review? }（docKind:'review' 场景）
   docMeta = { project?, file? }（会话层已知，ExtractResult 不带）
   review 各数组缺失均按 [] 处理；meta.intro 缺失走 parseReportMeta 的降级路径。 */
function buildReportModel(extractResult, docMeta) {
  const er = extractResult || {};
  const review = er.review || {};
  const apiMeta = er.meta || {};
  const dm = docMeta || {};

  const verdicts = review.verdicts || [];
  const recon = review.reconciliation || [];
  const claims = review.claims || [];
  const leftovers = review.leftovers || [];
  const details = review.details || [];

  const rawTitle = String(apiMeta.title || '');
  const title = rawTitle.replace(/^Review[:：]\s*/, '').trim();
  const parsed = parseReportMeta(apiMeta.intro);

  const meta = {
    title,
    project: dm.project || 'scribepad',
    file: dm.file || '',
    plan: parsed.plan,
    commits: parsed.commits,
    commitCount: parsed.commitCount,
    date: parsed.date,
    gates: parsed.gates,
    verifyCmd: parsed.verifyCmd,
    readingPath: parsed.readingPath,
  };

  const verdictsOut = verdicts.map((v) => ({ ...v, tagCls: riskTagCls(v.tag) }));
  const reconOut = recon.map((r) => ({ ...r, statusLabel: statusLabelOf(r.status) }));
  const leftoversOut = leftovers.map((l) => ({ ...l, kindLabel: kindLabelOf(l.kind) }));

  const deviatedCount = recon.filter((r) => r.status === 'deviated').length;
  const droppedCount = recon.filter((r) => r.status === 'dropped').length;
  const addedCount = recon.filter((r) => r.status === 'added').length;
  /* Claim.unverified === true ⇔ 证据栏标了 ⚠ unverified（types/domain.ts）。 */
  const unverifiedCount = claims.filter((c) => c.unverified === true).length;

  const sections = [
    { id: 'verdicts', n: '1', name: '需要你裁决', badge: verdicts.length + ' 项' },
    { id: 'recon', n: '2', name: '计划对账', badge: deviatedCount + droppedCount + addedCount + ' 偏差' },
    { id: 'claims', n: '3', name: '声明与证据', badge: unverifiedCount + ' 未核验' },
    { id: 'leftovers', n: '4', name: '遗留与假设', badge: leftovers.length + ' 项' },
    { id: 'details', n: '5', name: '变更明细', badge: details.length + ' 条' },
  ];

  const points = {};
  verdictsOut.forEach((v) => putPoint(points, v.label, 'verdict', 'verdicts', v.title, v.ifRejected || v.title, v.anchor));
  claims.forEach((c) => putPoint(points, c.label, 'claim', 'claims', c.claim, c.claim, c.anchor));
  leftoversOut.forEach((l) => putPoint(points, l.label, 'leftover', 'leftovers', l.text, l.text, l.anchor));

  const signable = [...verdicts.map((v) => v.label).filter(Boolean), ...leftovers.map((l) => l.label).filter(Boolean)];

  return {
    docKind: 'review',
    meta,
    sections,
    verdicts: verdictsOut,
    recon: reconOut,
    claims,
    leftovers: leftoversOut,
    details,
    points,
    signable,
    /* plan-mode REVIEW_MODEL 的引用图 / 分节索引 / 图例 / 决策卡字段——review 模式
       恒为空，但结构上给出，让任何未来的 REVIEW_MODEL.* 读取方（agent-service.jsx
       的 refStats() 等）不必各自记得防御性兜底 ||{} / ||[]。agent-service.jsx 的
       本地兜底仍保留（纵深防御）。 */
    inbound: {},
    byKind: {},
    legend: [],
    decisions: [],
  };
}

/* ── docKind 命令过滤：cmdk / SelToolbar 更多菜单在 review 文档下隐藏 plan-only
   条目（ai-review / ai-refs 命令；dcard / risk / open 选区操作）。按 CMDS /
   SEL_MORE（review-mock-data.jsx）里的稳定 id 精确匹配，不匹配展示文案——
   文案是本地化文本，id 才是跨模块契约。plan 文档（docKind 非 'review'）原样
   透传，不产生新数组引用之外的行为变化。 ── */
const PLAN_ONLY_CMD_IDS = new Set(['ai-review', 'ai-refs']);
const PLAN_ONLY_SEL_MORE_IDS = new Set(['dcard', 'risk', 'open']);

function filterCommandsForDocKind(cmds, docKind) {
  if (docKind !== 'review') return cmds;
  return (cmds || [])
    .map((g) => ({ ...g, items: (g.items || []).filter((it) => !PLAN_ONLY_CMD_IDS.has(it.id)) }))
    .filter((g) => g.items.length > 0);
}

function filterSelMoreForDocKind(items, docKind) {
  if (docKind !== 'review') return items;
  return (items || []).filter((it) => !PLAN_ONLY_SEL_MORE_IDS.has(it.id));
}

Object.assign(window, { parseReportMeta, buildReportModel, filterCommandsForDocKind, filterSelMoreForDocKind });

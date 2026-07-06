/* ═══ Spec Plan — 后端接线层（数据 / 持久化 / 换算）═══
   把 client-next 前端接到真实后端契约（types/api.ts）：会话打开、extract 重拉与
   重渲染入口、选区 → markdown 源锚点换算（rewrite / 批注共用）、批注 / 拍板与后端
   形态互转。纯换算与形态互转为纯函数（tests/unit 可单测）；IO 走 fetch。
   契约以 types/api.ts / types/annotation.ts 为准：
     · Annotation.anchor = { srcStart, srcEnd, text }（text = 创建时选区原文）
     · ExtractedItem.anchor = { srcStart, srcEnd }（无 text —— 源文本由 PLAN_DOC_SOURCE slice）
     · Signoff = { pointId, label, signedAt(ISO) }
     · rewrite-apply / annotations / signoffs 均为「整表替换」语义。 */

/* fetch JSON：非 2xx 抛 Error（message 取后端 error 字段），并挂 status 供调用方分流
   （rewrite-apply 的 409 drift → 提示刷新重试）。 */
async function fetchJson(method, url, body){
  const res=await fetch(url,{ method,
    headers: body?{ 'content-type':'application/json' }:undefined,
    body: body?JSON.stringify(body):undefined });
  if(!res.ok){
    let msg=res.status+' '+res.statusText;
    try{ const e=await res.json(); if(e&&e.error) msg=e.error; }catch(_){}
    const err=new Error(msg); err.status=res.status; throw err;
  }
  return res.json();
}

const sp=(sessionId)=>`/api/sessions/${encodeURIComponent(sessionId)}`;

/* ── REST 封装（一资源一函数）── */
function openPlan(doc){ return fetchJson('POST','/api/sessions/open',{ filePath:doc }); }
/* 服务器启动时打开的文档（fallback session）—— 无 ?doc 时默认跟随它 */
function getCurrentSession(){ return fetchJson('GET','/api/session'); }
function getExtract(sessionId){ return fetchJson('GET',`${sp(sessionId)}/extract`); }
function getFile(sessionId){ return fetchJson('GET',`${sp(sessionId)}/file`); }
function getAnnotations(sessionId){ return fetchJson('GET',`${sp(sessionId)}/annotations`); }
function postAnnotations(sessionId, annotations){ return fetchJson('POST',`${sp(sessionId)}/annotations`,{ annotations }); }
function getSignoffs(sessionId){ return fetchJson('GET',`${sp(sessionId)}/signoffs`); }
function postSignoffs(sessionId, signoffs){ return fetchJson('POST',`${sp(sessionId)}/signoffs`,{ signoffs }); }
function postRewriteApply(sessionId, items){ return fetchJson('POST',`${sp(sessionId)}/rewrite-apply`,{ items }); }
/* 完成审阅 · 交付：合上 `scribepad --wait` 的 agent 审阅闸。done 是终态动作——服务端把批准稿
   写到 outputPath 并 resolve --wait 的 waiter，agent 据此拿回稿继续。content = 当前审阅源
   （window.PLAN_DOC_SOURCE，与服务端文件同步）；缺省时 body 留空，服务端导出磁盘现有内容。 */
function postDone(sessionId, content){ return fetchJson('POST',`${sp(sessionId)}/done`, typeof content==='string'?{ content }:undefined); }

/* ExtractResult → PLAN_MODEL（复用 contract 层派生，后端字段变更时只对齐 plan-contract）。 */
function buildModelFromExtract(result, doc){
  return buildPlanModel(adaptExtract(result, { project:'scribepad', file:String(doc).split('/').pop() }));
}

/* 把一次抽取结果 + 源文档写入全局（App 只读 window.PLAN_MODEL / PLAN_DOC_SOURCE）。
   不负责重渲染——调用方（App）自行 bump 触发 re-render（复用同一入口：agent 落盘、
   rewrite-apply 落盘、顶栏刷新都经此更新全局 + bump）。 */
function applyPlanUpdate(result, content, doc){
  window.PLAN_MODEL=buildModelFromExtract(result, doc);
  if(typeof content==='string') window.PLAN_DOC_SOURCE=content;
}

/* 重拉 extract + 源文档 → 更新全局（agent mutated / 顶栏刷新 / 409 兜底共用）。 */
async function fetchPlanUpdate(sessionId, doc){
  const [ex, file]=await Promise.all([ getExtract(sessionId), getFile(sessionId) ]);
  applyPlanUpdate(ex.result, file.content, doc);
}

/* ── 选区 → markdown 源范围（纯函数，可单测）──
   anchor = { srcStart, srcEnd, text }，text = 源文档 slice(srcStart, srcEnd)。
   选区是 anchor.text 子串时精确定位；找不到（渲染文本 ≠ 源文本，如含 {token} / 表格转
   义）降级为整点范围。返回 selection 恒等于 source.slice(srcStart, srcEnd)——满足 rewrite
   落盘的 drift-guard（后端校验 doc.slice(srcStart,srcEnd) === selection）。 */
function computeSrcRange(selection, anchor){
  const sel=String(selection||'').trim();
  const i=sel?anchor.text.indexOf(sel):-1;
  if(sel&&i>=0){
    const srcStart=anchor.srcStart+i;
    return { srcStart, srcEnd:srcStart+sel.length, selection:sel };
  }
  return { srcStart:anchor.srcStart, srcEnd:anchor.srcEnd, selection:anchor.text };
}

/* ── 批注：前端卡片 ⇄ 后端 Annotation（纯函数，可单测）──
   前端卡片富展示字段（who/color/time/quote/body/status）；后端 Annotation 是持久化契约。
   body 存入 thread 的一条 note 消息；pt → plan-item target；status open/done 映射
   open/dismissed（后端无「resolved」态，dismissed 语义最近：用户主动关闭）。 */
const NOTE_AUTHOR={ who:'我', color:'#5b57d6' };

function noteToAnnotation(note){
  const created=note.createdAt||new Date().toISOString();
  return {
    id:note.id,
    anchor:note.anchor,
    target: note.pt
      ? { type:'plan-item', planItemId:note.pt, kind:note.kind||'goal', title:note.quote||'' }
      : { type:'selection' },
    thread: note.body?[{ id:note.id+'-m', role:'user', kind:'note', text:note.body, created_at:created }]:[],
    state:'draft',
    status: note.status==='done'?'dismissed':'open',
    history:[{ ts:created, action:'create' }],
    created_at:created,
  };
}

function annotationToNote(a){
  const pt=a.target&&a.target.type==='plan-item'?a.target.planItemId:null;
  const body=(a.thread||[]).filter(m=>m.kind==='note').map(m=>m.text).join('\n')||a.instruction||'';
  const text=(a.anchor&&a.anchor.text)||'';
  return {
    id:a.id, who:NOTE_AUTHOR.who, color:NOTE_AUTHOR.color, time:'刚刚',
    pt, quote:text.slice(0,40), body,
    status: a.status==='open'?'open':'done',
    anchor:a.anchor, kind:pt?a.target.kind:undefined, draft:false, createdAt:a.created_at,
  };
}

/* notes[] → { pt: {id, anchorText} }（AnnoText 渲染高亮用，替代 NOTE_ANCHORS 子串表）。
   anchorText 取 anchor.text（创建时选区原文，是渲染文本的子串）；每点保留第一条未解决批注。 */
function buildNoteHighlights(notes){
  const out={};
  (notes||[]).forEach(n=>{
    if(!n.pt||n.status==='done') return;
    const t=(n.anchor&&n.anchor.text)||n.quote;
    if(t&&!out[n.pt]) out[n.pt]={ id:n.id, anchorText:t };
  });
  return out;
}

/* ── 前置拍板：labels ⇄ Signoff[]（纯函数）──
   toggle：labels 里有则移除、无则加（新拍板取当前 ISO 时间，保留已有的 signedAt）。 */
function toggleSignoff(signoffs, label){
  return signoffs.some(s=>s.label===label)
    ? signoffs.filter(s=>s.label!==label)
    : [...signoffs, { pointId:label, label, signedAt:new Date().toISOString() }];
}

/* ── 交付态机（纯函数，可单测）──
   idle → delivering → delivered（终态，不可撤销）；delivering 失败回 idle 供重试。
   交付是终态动作，delivered 后任何事件都停在 delivered。 */
function deliverTransition(state, event){
  if(state==='delivered') return 'delivered';
  if(event==='start') return 'delivering';
  if(event==='ok') return 'delivered';
  if(event==='fail') return 'idle';
  return state;
}
/* 交付态 + 会话存在性 → 按钮呈现（无会话不可交付；交付中 / 交付后禁用）。 */
function deliverButton(state, hasSession){
  if(!hasSession) return { disabled:true, done:false, label:'完成审阅 · 交付' };
  if(state==='delivered') return { disabled:true, done:true, label:'已交付给 agent' };
  if(state==='delivering') return { disabled:true, done:false, label:'交付中…' };
  return { disabled:false, done:false, label:'完成审阅 · 交付' };
}

Object.assign(window,{
  fetchJson, openPlan, getCurrentSession, getExtract, getFile,
  getAnnotations, postAnnotations, getSignoffs, postSignoffs, postRewriteApply, postDone,
  buildModelFromExtract, applyPlanUpdate, fetchPlanUpdate,
  computeSrcRange, noteToAnnotation, annotationToNote, buildNoteHighlights, toggleSignoff,
  deliverTransition, deliverButton,
});

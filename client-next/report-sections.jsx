/* ═══ Review Doc — 交付审阅报告渲染层（review-sections.jsx 的对照件）═══
   docKind:'review' 时由 review-doc.jsx 的 DocView 分发到本文件。数据全部读
   REVIEW_MODEL（此时它承载 buildReportModel 产出的 REPORT_MODEL）：
     meta / sections×5 / verdicts / recon / claims / leftovers / details /
     points（导航注册表，与 plan 兼容）/ signable。
   约定与 review-sections.jsx 一致：每张裁决卡 / 声明行 / 遗留行带 data-pt +
   data-screen-label（选区批注 / 跳转 / scroll-spy 靠它们定位）；节头带 data-sec。
   降级铁律：REPORT_MODEL 各数组恒为数组，空数组走占位而非崩渲染。 */
const { useState: useStateRpt } = React;

/* ── 复制到剪贴板 + 短暂「已复制」反馈；剪贴板不可用时静默降级（不报错）。 ── */
function CopyCmd({ cmd, block }){
  const [copied, setCopied]=useStateRpt(false);
  function copy(){
    try{
      if(navigator.clipboard&&navigator.clipboard.writeText){
        navigator.clipboard.writeText(cmd).then(()=>{ setCopied(true); setTimeout(()=>setCopied(false),1200); }).catch(()=>{});
      }
    }catch(_){}
  }
  return (
    <button className={`rpt-cmd${block?' block':''}`} onClick={copy} title="点击复制命令">
      <code>{cmd}</code><span className="rpt-copy">{copied?<>{I.check}已复制</>:<>{I.copy}复制</>}</span>
    </button>
  );
}

/* ── 裁决卡的字段行：标签常规字重 + 内容（若否决 / 证据由调用方特殊处理）。 ── */
function VField({ label, value }){
  return <div className="rpt-field"><span className="rpt-fl">{label}</span><span className="rpt-fv">{value}</span></div>;
}

/* ── 引用芯片：点击滚到对应 [data-pt] 的裁决 / 声明 / 遗留（scrollIntoView，无路由）。 ── */
function PtRef({ label }){
  function go(){ const el=document.querySelector(`[data-pt="${label}"]`); if(el) el.scrollIntoView({ behavior:'smooth', block:'center' }); }
  return <button className="rpt-ref" onClick={go}>{label}</button>;
}

/* ═══ 节头（复用 .sec-h 版式，附节内计数徽标；保留 data-sec / data-screen-label）═══ */
function ReportSecHead({ sec }){
  return (
    <div className="sec-h rpt-sec-h" data-sec={sec.id} data-screen-label={`§${sec.n} ${sec.name}`}>
      <span className="n">0{sec.n}</span><h2>{sec.name}</h2>
      {sec.badge&&<span className="rpt-badge">{sec.badge}</span>}
    </div>
  );
}

/* ═══ §1 需要你裁决：每项一张卡（风险标签 + 字段列表 + 逐项批准）═══
   空裁决 → 安静占位卡；每张卡带 data-pt 供批注 / 跳转定位。 */
function VerdictsSection({ model, ctx }){
  const { verdicts }=model; const { signed, toggleSign }=ctx;
  if(!verdicts.length) return <div className="rpt-empty-card">本次无裁决事项</div>;
  return (
    <div className="rpt-verdicts">
      {verdicts.map(v=>{
        const on=signed.includes(v.label);
        return (
          <div key={v.label} className={`rpt-vcard${on?' signed':''}`} data-pt={v.label} data-screen-label={`裁决 ${v.label}`}>
            <div className="rpt-vhead">
              <span className="rpt-lbl">{v.label}</span>
              {v.tag&&<span className={`rpt-tag ${v.tagCls}`}>{v.tag}</span>}
              <b className="rpt-vtitle">{v.title}</b>
              <button className={`rpt-sign${on?' ok':''}`} onClick={()=>toggleSign(v.label)}>
                {on?<>{I.check}已批准</>:'批准'}
              </button>
            </div>
            <div className="rpt-fields">
              {v.context&&<VField label="背景" value={v.context}/>}
              {v.chosen&&<VField label="我选了" value={v.chosen}/>}
              {v.alternative&&<VField label="备选" value={v.alternative}/>}
              {v.whyNotAsked&&<VField label="为什么没停下来问" value={v.whyNotAsked}/>}
              {v.ifRejected&&<div className="rpt-field warn"><span className="rpt-fl">若否决</span><span className="rpt-fv">{v.ifRejected}</span></div>}
              {v.evidence&&<div className="rpt-field"><span className="rpt-fl">证据</span><code className="rpt-ev">{v.evidence}</code></div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ═══ §2 计划对账：plan 条目 / 状态（色底 pill）/ 说明（含引用芯片）═══ */
const RECON_PILL={ done:'ok', deviated:'warn', dropped:'bad', added:'add', unknown:'na' };
function ReconSection({ model }){
  const { recon }=model;
  if(!recon.length) return <p className="rpt-empty-line">无对账条目</p>;
  return (
    <div className="tbl-wrap">
      <table className="mtx rpt-tbl">
        <thead><tr><th>plan 条目</th><th style={{width:'92px'}}>状态</th><th>说明</th></tr></thead>
        <tbody>
          {recon.map((r,i)=>(
            <tr key={i}>
              <td>{r.item||'—'}</td>
              <td><span className={`rpt-pill ${RECON_PILL[r.status]||'na'}`}>{r.statusLabel}</span></td>
              <td>
                {r.note&&r.note!=='—'?<span className="rpt-note">{r.note}</span>:<span className="rpt-dim">—</span>}
                {r.refs&&r.refs.length>0&&<span className="rpt-refs">{r.refs.map(l=><PtRef key={l} label={l}/>)}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ═══ §3 声明与证据：# / 声明 / 证据 / 核验方式；未核验行黄底 + ⚠ 芯片 ═══
   核验命令 mono + 点击复制；行根带 data-pt。 */
function ClaimsSection({ model }){
  const { claims }=model;
  if(!claims.length) return <p className="rpt-empty-line">无声明</p>;
  return (
    <div className="tbl-wrap">
      <table className="mtx rpt-tbl rpt-claims">
        <thead><tr><th style={{width:'44px'}}>#</th><th>声明</th><th>证据</th><th>核验方式</th></tr></thead>
        <tbody>
          {claims.map(c=>(
            <tr key={c.label} data-pt={c.label} className={c.unverified?'rpt-unv':''}>
              <td className="rpt-clbl">{c.label}</td>
              <td>{c.claim}</td>
              <td>{c.unverified?<span className="rpt-warnchip">⚠ 未核验</span>:(c.evidence?<span className="rpt-note">{c.evidence}</span>:<span className="rpt-dim">—</span>)}</td>
              <td>{c.verify?<CopyCmd cmd={c.verify}/>:<span className="rpt-dim">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ═══ §4 遗留与假设：标签 + 类型芯片 + 正文 + 触发/验证次要行；逐项知晓确认 ═══ */
const LEFTOVER_COND_PREFIX={ deferred:'触发条件', assumption:'验证方式', limitation:'', unknown:'' };
function LeftoversSection({ model, ctx }){
  const { leftovers }=model; const { signed, toggleSign }=ctx;
  if(!leftovers.length) return <p className="rpt-empty-line">无遗留事项</p>;
  return (
    <div className="rpt-leftovers">
      {leftovers.map(l=>{
        const on=signed.includes(l.label);
        const pre=LEFTOVER_COND_PREFIX[l.kind];
        return (
          <div key={l.label} className={`rpt-lrow${on?' signed':''}`} data-pt={l.label} data-screen-label={`遗留 ${l.label}`}>
            <div className="rpt-lmain">
              <span className="rpt-lbl">{l.label}</span>
              <span className={`rpt-kind ${l.kind}`}>{l.kindLabel}</span>
              <span className="rpt-ltext">{l.text}</span>
              <button className={`rpt-sign${on?' ok':''}`} onClick={()=>toggleSign(l.label)}>
                {on?<>{I.check}已确认</>:'已知晓'}
              </button>
            </div>
            {l.condition&&<div className="rpt-lcond">{pre?<b>{pre}</b>:null}{l.condition}</div>}
          </div>
        );
      })}
    </div>
  );
}

/* ═══ §5 变更明细：默认折叠（<details>）；展开后 mono 紧凑列表 ═══ */
function DetailsSection({ model }){
  const { details }=model;
  if(!details.length) return <p className="rpt-empty-line">无变更明细</p>;
  return (
    <details className="rpt-details">
      <summary className="rpt-dsum">{details.length} 条变更明细 · 点击展开</summary>
      <ul className="rpt-dlist">{details.map((d,i)=><li key={i}>{d.text}</li>)}</ul>
    </details>
  );
}

/* ═══ 注册表：节 id → 渲染器（顺序由 REPORT_MODEL.sections 决定）═══ */
const REPORT_SECTION_RENDERERS = {
  verdicts: VerdictsSection,
  recon:    ReconSection,
  claims:   ClaimsSection,
  leftovers:LeftoversSection,
  details:  DetailsSection,
};

/* ═══ 文档壳层（plan DocView 的对照件）═══
   文档头：标题 + meta 芯片行（plan / commits / 日期）+ 门禁 pill + 复核命令 + 建议路径，
   再按 REPORT_MODEL.sections 顺序经 REPORT_SECTION_RENDERERS 分发。diffEntry 仅为与
   plan DocView 保持签名一致（审阅报告无历史 diff 内嵌），此处不消费。 */
function ReportDocView({ signed, toggleSign }){
  const model=REVIEW_MODEL;
  const meta=model.meta;
  const ctx={ signed, toggleSign };
  return (
    <div className="doc-wrap doc" id="docText">
      <div className="doc-flag rpt-flag">
        <span className="tag rpt-kindtag">交付审阅</span>
        <span className="tag">{meta.project} / {meta.file}</span>
      </div>
      <h1 className="doc-title">{meta.title||'（无标题）'}</h1>

      <div className="rpt-meta">
        {meta.commits&&<span className="rpt-m"><i>commits</i><code>{meta.commits}</code>{meta.commitCount!=null&&<em>{meta.commitCount} 个</em>}</span>}
        {meta.date&&<span className="rpt-m"><i>日期</i>{meta.date}</span>}
      </div>
      {meta.plan&&<div className="rpt-plan" title={meta.plan}><i>plan</i><code>{meta.plan}</code></div>}

      {meta.gates&&meta.gates.length>0&&(
        <div className="rpt-gates">
          {meta.gates.map((g,i)=>(
            <span key={i} className={`rpt-gate ${g.ok?'ok':'bad'}`}>{g.ok?'✓':'✗'} {g.name}</span>
          ))}
        </div>
      )}

      {meta.verifyCmd&&(
        <div className="rpt-verify"><CopyCmd cmd={meta.verifyCmd} block/></div>
      )}
      {meta.readingPath&&<div className="rpt-reading"><i>建议路径</i>{meta.readingPath}</div>}

      {model.sections.map(sec=>{
        const Renderer=REPORT_SECTION_RENDERERS[sec.id];
        return (
          <React.Fragment key={sec.id}>
            <ReportSecHead sec={sec}/>
            {Renderer?<Renderer model={model} ctx={ctx}/>:null}
          </React.Fragment>
        );
      })}
    </div>
  );
}

/* ═══ 右栏（审阅模式最小面板）：裁决进度 + 图例（plan 三 tab 面板不在此模式渲染）═══ */
function ReportRightPanel({ signed }){
  const model=REVIEW_MODEL;
  const signable=model.signable||[];
  const signedSet=new Set(signed||[]);
  const done=signable.filter(l=>signedSet.has(l)).length;
  return (
    <aside className="rightbar">
      <div className="rb-body">
        <div className="fade-in rpt-rp">
          <div className="dash-sec">
            <div className="dash-h">裁决进度<span className="mo">{done} / {signable.length}</span></div>
            {signable.length>0
              ? <div className="rpt-chips">
                  {signable.map(l=>{
                    const on=signedSet.has(l);
                    return (
                      <button key={l} className={`rpt-schip${on?' on':''}`} title={on?'已批准 / 已确认':'待处理'}
                        onClick={()=>{ const el=document.querySelector(`[data-pt="${l}"]`); if(el) el.scrollIntoView({ behavior:'smooth', block:'center' }); }}>
                        {on&&I.check}{l}
                      </button>
                    );
                  })}
                </div>
              : <div className="signhint">本报告无需签字项</div>}
          </div>
          <div className="dash-sec" style={{marginBottom:0}}>
            <div className="dash-h">图例</div>
            <div className="rpt-legend">
              <span><b className="rpt-lg d">D</b> 裁决</span>
              <span><b className="rpt-lg c">C</b> 声明</span>
              <span><b className="rpt-lg l">L</b> 遗留</span>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

Object.assign(window, { REPORT_SECTION_RENDERERS, ReportDocView, ReportRightPanel, CopyCmd, PtRef });

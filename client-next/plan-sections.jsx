/* ═══ Spec Plan — 8 节渲染器注册表 ═══
   每节一个组件，统一签名：({ sec, points, ctx })
     sec    — 节定义（含 kicker / lead / extras，见 plan-fixture）
     points — 该节的信息点（PLAN_MODEL.byKind[sec.kind]）
     ctx    — { signed, toggleSign } 等交互回调
   新增 / 替换某节形态：写一个组件，注册进 SECTION_RENDERERS 即可。
   未注册的节走 GenericSection 兜底。 */

/* ── 批注锚点：把 mock 批注的 anchorText 包成可点高亮 ──
   NOTE_ANCHORS（label → {id, anchorText}）由 plan-mock-data.jsx 提供。 */
function AnnoText({ s, pt }){
  const note=(window.NOTE_ANCHORS||{})[pt];
  if(!note||!String(s).includes(note.anchorText)) return <T s={s}/>;
  const i=String(s).indexOf(note.anchorText);
  return <>
    <T s={s.slice(0,i)}/>
    <span className="anno-mark" data-note={note.id}>{note.anchorText}</span>
    <T s={s.slice(i+note.anchorText.length)}/>
  </>;
}

/* ═══ §1 目标：现状模型对照表 + bug callout + 渗透面 + 硬约束列表 ═══ */
function GoalSection({ sec, points }){
  const gates=points.filter(p=>p.role==='gate');
  const bugs=points.filter(p=>p.role==='bug');
  const { models, penetration }=sec.extras||{};
  return <>
    {sec.lead&&<p className="lead">{sec.lead}</p>}
    {models&&(
      <div className="tbl-wrap">
        <table className="mtx">
          <thead><tr><th style={{width:'34%'}}>模型</th><th>kind 分类</th><th>状态机</th><th>现状</th></tr></thead>
          <tbody>
            {models.map(m=>(
              <tr key={m.name}>
                <td>{m.name}<span className="cell-sub">{m.loc}</span></td>
                <td>{m.kinds}</td>
                <td style={{fontFamily:'var(--mono)',fontSize:'11.5px'}}>{m.state}</td>
                <td><span className={`pill ${m.tone}`}>{m.now}</span><span className="cell-sub" style={{fontFamily:'var(--sans)'}}>{m.note}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
    {bugs.length>0&&(
      <div className="bug-callout">
        <p><b>⚠ 已核实 {bugs.length} 个真 bug</b>（均在「锁 — 防漂移」这条线上）</p>
        {bugs.map(b=>(
          <p key={b.label} data-pt={b.label}><b>{b.label}</b>　<span className="bt">{b.title}</span>——{b.text}</p>
        ))}
      </div>
    )}
    {penetration&&<p className="fine">{penetration}</p>}
    <div className="sub-h">成功约束<span className="k">硬约束 · 方案取舍与验收都以此为准</span></div>
    <div className="glist">
      {gates.map(g=>(
        <div key={g.label} className="grow" data-pt={g.label} data-screen-label={`硬约束 ${g.label}`}>
          <span className="lbl">{g.label}</span>
          <div className="gt2">
            <b>{g.title}</b>
            <div className="gc"><T s={g.text}/></div>
          </div>
        </div>
      ))}
    </div>
  </>;
}

/* ═══ §2 边界：范围内 / 范围外 ═══ */
function ScopeSection({ points }){
  const inn=points.filter(p=>p.role==='in');
  const out=points.filter(p=>p.role==='out');
  return <>
    <div className="sub-h" style={{marginTop:'18px'}}>范围内</div>
    <ul className="d">{inn.map(p=><li key={p.id}><T s={p.text}/></li>)}</ul>
    <div className="sub-h">范围外<span className="k">non-goals · agent 不得触碰</span></div>
    <ul className="d">
      {out.map(p=>(
        <li key={p.id}><b>{p.ui.verb} {p.ui.rest}</b>　—　<T s={p.text}/></li>
      ))}
    </ul>
  </>;
}

/* ═══ §3 决策：候选对比表（✓ 选定 / ✗ 被否 + 理由）═══ */
function DecSection({ ctx }){
  return <>
    {PLAN_MODEL.decisions.map(d=>(
      <div key={d.label} className="dsec" data-pt={d.label} data-screen-label={`决策 ${d.label}`}>
        <div className="dt">
          <span className="dlb">{d.label}</span>
          <b>{d.question}</b>
          {d.core&&<span className="core">核心</span>}
          <span className={`fstag ${d.status==='decided'?'g':'o'}`}>{d.status==='decided'?'已定':'待定'}</span>
        </div>
        <div className="tbl-wrap">
          <table className="mtx dtable">
            <thead><tr><th style={{width:'27%'}}>候选</th><th style={{width:'64px'}}>结论</th><th>理由</th></tr></thead>
            <tbody>
              <tr className="pick">
                <td><b><AnnoText s={d.pick} pt={d.label}/></b><span className="cell-sub2"><T s={d.chosen}/></span></td>
                <td><span className="fstag g">✓ 选定</span></td>
                <td><T s={d.rationale}/></td>
              </tr>
              {d.rejected.map((r,i)=>(
                <tr key={i} className="norow"><td>{r.option}</td><td><span className="fstag gr">✗ 否</span></td><td><T s={r.reason}/></td></tr>
              ))}
            </tbody>
          </table>
        </div>
        {d.facts&&<p className="dnote"><b>依赖事实</b><T s={d.facts}/></p>}
        {d.cost&&<p className="dnote cost"><b>代价</b><T s={d.cost}/></p>}
      </div>
    ))}
  </>;
}

/* ═══ §4 做法：步骤 rail + 模块结构树 + 子 commit ═══ */
function HowSection({ sec, points }){
  const tree=(sec.extras||{}).tree;
  return <>
    {sec.lead&&<p><T s={sec.lead}/></p>}
    <div className="steps">
      {points.map(s=>(
        <div key={s.label} className="step" data-pt={s.label} data-screen-label={`做法 §4.${s.ui.num}`}>
          <div className="rail"><span className="num">{s.ui.num}</span><span className="line"></span></div>
          <div className="sc" style={{minWidth:0,flex:1}}>
            <div className="sh">{s.title}</div>
            <div className="file">{s.ui.file}</div>
            {s.ui.tree&&tree&&(
              <div className="code tree" style={{margin:'10px 0 8px'}}>
                <div className="code-head"><span className="dots"><i></i><i></i><i></i></span><span className="lang">core/extract · 模块结构</span></div>
                <pre>{tree.map(([f,c],i)=>(
                  <div key={i}><span className="tk-fn">{f}</span>{c&&<span className="tc">  # {c}</span>}</div>
                ))}</pre>
              </div>
            )}
            {s.ui.pts&&<ul className="spts">{s.ui.pts.map((p,i)=><li key={i}><T s={p}/></li>)}</ul>}
            {s.ui.subs&&(
              <ul className="spts">
                {s.ui.subs.map(x=>(
                  <li key={x.k}><b>{x.k}　{x.t}</b>　<T s={x.d}/></li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ))}
    </div>
  </>;
}

/* ═══ §5 验收：按第一个引用（硬约束 / 决策）归组的 checklist ═══ */
function AccSection({ points }){
  return (
    <div className="accl acc-g">
      {points.map((a,i)=>{
        const g=a.refs[0];
        const prev=i>0?points[i-1].refs[0]:null;
        const meta=PLAN_MODEL.points[normLabel(g)]||{};
        const count=points.filter(x=>x.refs[0]===g).length;
        return (
          <React.Fragment key={a.label}>
            {g!==prev&&(
              <div className="ah"><Ref l={g}/><span className="an-t">{String(meta.title||'').replace(/^§[\d.]+\s*/,'')}</span><span className="an">{count} 条断言</span></div>
            )}
            <div className="accit" data-pt={a.label} data-screen-label={`验收 ${i+1}`}>
              <span className="box"></span>
              <span className="tx">{a.text}{a.refs.length>1&&<span className="chips">　{a.refs.slice(1).map(r=><Ref key={r} l={r}/>)}</span>}</span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

/* ═══ §6 风险：等级 + 缓解 ═══ */
function RiskSection({ points }){
  return (
    <div className="riskl">
      {points.map(r=>(
        <div key={r.label} className="riskrow" data-pt={r.label} data-screen-label={`风险 ${r.label}`}>
          <span className="lbl">{r.label}</span>
          <div className="rc">
            <div className="rt"><AnnoText s={r.ui.risk} pt={r.label}/></div>
            <div className="rfix">缓解　<T s={r.ui.fix}/></div>
          </div>
          <span className={`lvl ${r.ui.lvl==='中'?'mid':'low'}`}>{r.ui.lvl}</span>
        </div>
      ))}
    </div>
  );
}

/* ═══ §7 前置：拍板（签字持久化）═══ */
function PreSection({ points, ctx }){
  const { signed, toggleSign }=ctx;
  return (
    <div className="prel">
      {points.map(p=>(
        <div key={p.label} className={`pre${signed.includes(p.label)?' ok':''}`} data-pt={p.label} data-screen-label={`前置 ${p.label}`}>
          <span className="lbl p">{p.label}</span>
          <div className="pt2">
            <div className="tx"><AnnoText s={p.text} pt={p.label}/></div>
            <div className="meta">卡 <Ref l={p.ui.blocks}/> · 拍板前该步骤不得开工</div>
          </div>
          <button className={`sign${signed.includes(p.label)?' ok':''}`} onClick={()=>toggleSign(p.label)}>
            {signed.includes(p.label)?<>{I.check}已拍板</>:'拍板'}
          </button>
        </div>
      ))}
    </div>
  );
}

/* ═══ §8 待确认：问题卡（owner / 卡点 / 截止）═══ */
function OpenSection({ points }){
  return (
    <div className="qlist">
      {points.map(q=>(
        <div key={q.label} className="qcard" data-pt={q.label} data-screen-label={`待确认 ${q.label}`}>
          <div className="qt"><span className="lbl">{q.label}</span>{q.ui.short}</div>
          <div className="qf"><T s={q.text}/></div>
          <div className="qm"><span>owner <b>{q.ui.owner}</b></span><span>卡 <b><T s={q.ui.blocks}/></b></span><span>截止 <b>{q.ui.due}</b></span></div>
        </div>
      ))}
    </div>
  );
}

/* ═══ 兜底：未注册节形态 → 通用点列表 ═══ */
function GenericSection({ points }){
  return (
    <ul className="d">
      {points.map(p=>(
        <li key={p.id} data-pt={p.label||undefined}>
          {p.label&&<b>{p.label}　</b>}{p.title&&<b>{p.title}　</b>}<T s={p.text||''}/>
        </li>
      ))}
    </ul>
  );
}

/* ═══ 注册表：节 id → 渲染器 ═══ */
const SECTION_RENDERERS = {
  goal: GoalSection,
  scope:ScopeSection,
  dec:  DecSection,
  how:  HowSection,
  acc:  AccSection,
  risk: RiskSection,
  pre:  PreSection,
  open: OpenSection,
};

Object.assign(window,{ SECTION_RENDERERS, GenericSection, AnnoText });

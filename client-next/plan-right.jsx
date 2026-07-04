/* ═══ Spec Plan — 右侧面板：总览（审阅清单）+ 批注 + 历史 ═══
   数据全部从 PLAN_MODEL 派生（清单数量随文档内容自动变化）。 */

const rangeLabel=(pts)=>pts.length?`${pts[0].label}–${pts[pts.length-1].label}`:'';

/* ── Tab 1 · 总览：审阅清单（防遗漏）+ 前置拍板进度 ── */
function PlanDash({ scrollTo, signed, seenSecs }){
  const gates=PLAN_MODEL.byKind['goal'].filter(p=>p.role==='gate');
  const decs=PLAN_MODEL.decisions;
  const midRisks=PLAN_MODEL.byKind['risk'].filter(p=>p.ui.lvl==='中');
  const pres=PLAN_MODEL.byKind['precondition'];
  const opens=PLAN_MODEL.byKind['open-question'];
  const allSigned=signed.length===pres.length;
  const miss=[
    { sec:'dec',  t:`${decs.length} 个核心决策（${decs[0].label}–${decs[decs.length-1].label}）`, note:'均已定 · 本文档的中心' },
    { sec:'goal', t:`${gates.length} 条硬约束（${rangeLabel(gates)}）`, note:'方案取舍与验收的基准' },
    { sec:'risk', t:`${midRisks.length} 个中风险（${midRisks.map(r=>r.label).join(' / ')}）`, note:'本期主要的不确定性' },
    { sec:'pre',  t:`${pres.length} 个前置待拍板（${rangeLabel(pres)}）`, note:allSigned?'已全部拍板':`${signed.length}/${pres.length} 已拍板 · 不拍板不开工`, needSign:true },
    { sec:'open', t:`${opens.length} 个待确认（${rangeLabel(opens)}）`, note:'不卡开工 · 各卡一环' },
  ];
  const isDone=(m)=> m.needSign ? (seenSecs.has(m.sec)&&allSigned) : seenSecs.has(m.sec);
  const doneN=miss.filter(isDone).length;
  return (
    <div className="fade-in">
      <div className="dash-sec">
        <div className="dash-h">审阅清单 · 别漏掉<span className="mo">{doneN}/{miss.length}</span></div>
        {miss.map(m=>(
          <button key={m.sec} className={`miss${isDone(m)?' done':''}`} onClick={()=>scrollTo(m.sec)}>
            <span className="st">{isDone(m)&&I.check}</span>
            <span className="tx">{m.t}<span>{m.note}</span></span>
          </button>
        ))}
        <div className="rb-hint" style={{marginTop:8}}>{I.info}<span>滚动读过对应小节后自动勾掉；「前置」还需 {pres.length} 项全部拍板。</span></div>
      </div>
      <div className="dash-sec" style={{marginBottom:0}}>
        <div className="dash-h">前置拍板<span className="mo">{signed.length} / {pres.length}</span></div>
        <div className="signseg">
          {pres.map(p=>(
            <button key={p.label} className={`sgn${signed.includes(p.label)?' on':''}`} onClick={()=>scrollTo('pre')} title={p.ui.short}>
              {signed.includes(p.label)?I.check:p.label}
            </button>
          ))}
        </div>
        <div className="signhint">{allSigned?<><span className="ok">{I.check}</span>{pres.length} 项已全部拍板，可开工</>:`还差 ${pres.length-signed.length} 项 · 未拍板步骤不开工`}</div>
      </div>
    </div>
  );
}

/* ── Tab 2 · 批注：卡片（定位 / 解决）+ 草稿编辑 + 勾选批量分析 ── */
function NotesPanel({ notes, onResolve, onUpdate, onFocus, pulseId, selectedNotes, onToggleSel, onAnalyze }){
  const openN=notes.filter(n=>n.status!=='done').length;
  const selN=selectedNotes.length;
  if(!notes.length) return (
    <div className="fade-in rb-empty">
      {I.note}
      <b>还没有批注</b>
      <span>在正文划选一段文字，选「批注」即可添加。</span>
    </div>
  );
  return (
    <div className="fade-in">
      <div className="notes-bar">
        <span className="nb-t">{selN>0?`已选 ${selN} 条`:`${openN} 条待处理`}</span>
        <button className="nb-go" onClick={onAnalyze}>{I.sparkF}{selN>0?`分析选中 ${selN} 条`:'全部交给 AI 分析'}</button>
      </div>
      {notes.map(n=>(
        <div key={n.id} className={`note${n.status==='done'?' resolved':''}${pulseId===n.id?' pulse':''}${selectedNotes.includes(n.id)?' sel':''}`}>
          <div className="nh">
            <button className={`nsel${selectedNotes.includes(n.id)?' on':''}`} onClick={e=>{e.stopPropagation();onToggleSel(n.id);}} title="选入批量分析">{selectedNotes.includes(n.id)&&I.check}</button>
            <span className="av" style={{background:n.color}}>{n.who[0]}</span><span className="nm">{n.who}</span>
            {n.pt&&<span className="npt" onClick={e=>{e.stopPropagation();jumpTo(n.pt);}}>{n.pt}</span>}
            <span className="tm">{n.time}</span>
          </div>
          <div className="nq" onClick={()=>onFocus(n)}>“{n.quote}”</div>
          {n.draft
            ? <input className="nb-in" placeholder="写下批注内容，回车保存…" value={n.body} autoFocus
                onChange={e=>onUpdate(n.id,{body:e.target.value})}
                onKeyDown={e=>{ if(e.key==='Enter'&&n.body.trim()) onUpdate(n.id,{draft:false}); }}
                onClick={e=>e.stopPropagation()}/>
            : <div className="nb" onClick={()=>onFocus(n)}>{n.body}</div>}
          <div className="nf">
            <span className={`status ${n.status}`}>{n.status==='done'?'已解决':'待处理'}</span>
            <button className="rsv" onClick={e=>{e.stopPropagation();onResolve(n.id);}}>{I.check}{n.status==='done'?'重新打开':'标记解决'}</button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Tab 3 · 历史：版本时间线 → 原文内嵌 diff ── */
function HistPanel({ history, diffEntry, onShowDiff }){
  return (
    <div className="fade-in hist">
      {history.map((h,i)=>(
        <div key={h.id} className={`hrow clickable${i===0?' now':''}`}>
          <div className="hrail"><span className={`hic ${h.who}`}>{I[h.icon]}</span><span className="hline"></span></div>
          <div className="hc" onClick={()=>onShowDiff(diffEntry&&diffEntry.id===h.id?null:h)}>
            <div className="hd"><b>{h.desc[0]}</b>{h.desc[1]?<> {h.desc[1]}</>:null}</div>
            <div className="hm">
              <span>{h.time}</span>
              {i===0&&<span className="cur">当前版本</span>}
              <span className="viewdiff" style={diffEntry&&diffEntry.id===h.id?{opacity:1,color:'var(--accent)'}:null}>
                {I.history}{diffEntry&&diffEntry.id===h.id?'正在原文中展示':'在原文中查看改动'}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── 右栏外壳 ── */
function RightPanel({ tab, setTab, scrollTo, signed, seenSecs,
                      notes, onResolveNote, onUpdateNote, onFocusNote, pulseNoteId,
                      selectedNotes, onToggleNoteSel, onAnalyzeNotes,
                      history, diffEntry, onShowDiff }){
  const openNotes=notes.filter(n=>n.status!=='done').length;
  return (
    <aside className="rightbar">
      <div className="rb-tabs">
        <button className={`rb-tab${tab==='dash'?' on':''}`} onClick={()=>setTab('dash')}>{I.dash}总览</button>
        <button className={`rb-tab${tab==='notes'?' on':''}`} onClick={()=>setTab('notes')}>{I.note}批注{openNotes>0&&<span className="cnt">{openNotes}</span>}</button>
        <button className={`rb-tab${tab==='hist'?' on':''}`} onClick={()=>setTab('hist')}>{I.clock}历史</button>
      </div>
      <div className="rb-body">
        {tab==='dash'&&<PlanDash scrollTo={scrollTo} signed={signed} seenSecs={seenSecs}/>}
        {tab==='notes'&&<NotesPanel notes={notes} onResolve={onResolveNote} onUpdate={onUpdateNote} onFocus={onFocusNote} pulseId={pulseNoteId} selectedNotes={selectedNotes} onToggleSel={onToggleNoteSel} onAnalyze={onAnalyzeNotes}/>}
        {tab==='hist'&&<HistPanel history={history} diffEntry={diffEntry} onShowDiff={onShowDiff}/>}
      </div>
    </aside>
  );
}

Object.assign(window,{ RightPanel });

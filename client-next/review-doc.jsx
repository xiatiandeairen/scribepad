/* ═══ Spec Plan — 文档壳层 ═══
   文档头（状态 / 标题 / 署名 / tldr）+ 按 REVIEW_MODEL.sections 顺序
   经 SECTION_RENDERERS 注册表分发渲染；历史 diff 内嵌插到对应节下。 */

function SecHead({ sec }){
  const { id, n, name, kicker, pseudo }=sec;
  return (
    <div className="sec-h" data-sec={id} data-pt={pseudo} data-screen-label={`§${n} ${name}`}>
      <span className="n">0{n}</span><h2>{name}</h2>
      {kicker && <span className="k">{kicker}</span>}
    </div>
  );
}

/* 历史 diff 的原文内嵌展示（点历史条目后出现在对应小节下方） */
function InlineDiff({ entry }){
  const d=entry.diff||{};
  return (
    <div className="diff-inline" data-diff-inline="1">
      <div className="dm">{I.history}<span><b>{entry.desc[0]}{entry.desc[1]?' '+entry.desc[1]:''}</b> · {entry.who==='ai'?'Spec AI · ':''}{entry.time}</span></div>
      {d.kind==='add'
        ? <p className="ins">{d.summary}</p>
        : <><p className="del">{d.before}</p><p className="ins">{d.after}</p></>}
    </div>
  );
}

function DocView({ signed, toggleSign, diffEntry }){
  /* docKind:'review' → 交付审阅报告壳层（report-sections.jsx）；plan 走下方原路径。 */
  if(REVIEW_MODEL.docKind==='review') return <ReportDocView signed={signed} toggleSign={toggleSign} diffEntry={diffEntry}/>;
  const meta=REVIEW_MODEL.meta;
  const ctx={ signed, toggleSign };
  return (
    <div className="doc-wrap doc" id="docText">
      <div className="doc-flag">
        <span className="tag amber"><span className="d"></span>{meta.status}</span>
        <span className="tag">{I.branch}{meta.branch}</span>
        <span className="tag">plan 固定 {REVIEW_MODEL.sections.length} 节 · 核心决策在 §3</span>
      </div>
      <h1 className="doc-title">{meta.title}</h1>
      <div className="doc-byline">
        <span className="who"><span className="mini-av">AI</span>Spec AI 起草</span>
        <span>·</span><span>周衍 review 中</span>
        <span>·</span><span><T s={meta.fixture}/></span>
      </div>
      <div className="tldr"><b>一句话：</b>{meta.tldr}</div>

      {REVIEW_MODEL.sections.map(sec=>{
        const Renderer=SECTION_RENDERERS[sec.id]||GenericSection;
        return (
          <React.Fragment key={sec.id}>
            <SecHead sec={sec}/>
            {diffEntry&&diffEntry.sec===sec.id&&<InlineDiff entry={diffEntry}/>}
            <Renderer sec={sec} points={REVIEW_MODEL.byKind[sec.kind]||[]} ctx={ctx}/>
          </React.Fragment>
        );
      })}
    </div>
  );
}

Object.assign(window,{ DocView, SecHead, InlineDiff });

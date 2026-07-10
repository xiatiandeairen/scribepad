/* ═══ Spec Plan — App 外壳 ═══
   组合：顶栏 / 对话（ChatPanel）/ 文档（DocView）/ 右栏（RightPanel）。
   跨模块逻辑都收敛在 hooks（review-hooks.jsx）与 AgentService（agent-service.jsx）；
   本文件只做状态编排与事件接线。 */
const { useState, useRef, useEffect } = React;

const SEL_OP_TEXT={ dcard:'把这段转成决策卡', risk:'把这段提为风险项', open:'把这段提为待确认', explain:'解释这段' };

/* 选区 range → 所属信息点 label（最近的 [data-pt]）；供 rewrite / 批注锚点换算用。 */
function ptLabelOfRange(range){
  if(!range) return null;
  let node=range.commonAncestorContainer;
  if(node&&node.nodeType===3) node=node.parentElement;
  const el=node&&node.closest?node.closest('[data-pt]'):null;
  return el?el.getAttribute('data-pt'):null;
}
/* label → 该点的注册表条目 / 源锚点 / kind。决策卡点无 point.anchor（DecisionCard 无锚点）→ 返回 null。 */
function pointEntryOf(label){ return label?(REVIEW_MODEL.points[normLabel(label)]||null):null; }
function pointAnchorOf(label){ const e=pointEntryOf(label); return e&&e.point&&e.point.anchor?e.point.anchor:null; }
function pointKindOf(label){ const e=pointEntryOf(label); return e&&e.point?e.point.kind:undefined; }

/* 选区 + 源锚点 → 结构化锚点 { srcStart, srcEnd, text }（批注用；text=选区原文供高亮/溯源）。
   优先按信息点锚点换算；无点锚点时在整源找子串兜底；都失败返回 null（无法定位）。 */
function buildSelectionAnchor(sel, label){
  const src=window.REVIEW_DOC_SOURCE||'';
  const anchor=pointAnchorOf(label);
  if(anchor){
    const r=computeSrcRange(sel,{ srcStart:anchor.srcStart, srcEnd:anchor.srcEnd, text:src.slice(anchor.srcStart,anchor.srcEnd) });
    return { srcStart:r.srcStart, srcEnd:r.srcEnd, text:sel };
  }
  const i=src.indexOf(sel);
  if(i>=0) return { srcStart:i, srcEnd:i+sel.length, text:sel };
  return null;
}

function App({ sessionId, doc }){
  /* ── 布局 / 面板 ── */
  const [chatOpen,setChatOpen]=useState(true);
  const [rightOpen,setRightOpen]=useState(true);
  const [rightTab,setRightTab]=useState('dash');
  const [cmdk,setCmdk]=useState(false);
  const [settingsOpen,setSettingsOpen]=useState(false);
  const [agentOpen,setAgentOpen]=useState(false);
  const [agentCfg,setAgentCfg]=useState(AGENT_DEFAULT);
  const { settings, setSettings, toggleTheme } = useSettings();
  const [toast,flash]=useToast();

  /* ── 会话 / 消息 ── */
  const [sessions,setSessions]=useState(SESSIONS);
  const [activeSid,setActiveSid]=useState(SESSIONS[0].id);
  const [messages,setMessages]=useState(SESSIONS[0].msgs);
  const [thinking,setThinking]=useState(null);
  const [selCtx,setSelCtx]=useState(null);

  /* ── 文档 / 审阅 ── */
  const [saveState,setSaveState]=useState('saved');
  const [spin,setSpin]=useState(false);
  const [delivery,setDelivery]=useState('idle');  /* 交付态机：idle → delivering → delivered（终态） */
  const delivered=delivery==='delivered';
  const [signoffs,setSignoffs]=useState([]);      /* 后端 Signoff[] 为单一真源 */
  const signed=signoffs.map(s=>s.label);          /* 派生：UI 只认 label 列表 */
  const [notes,setNotes]=useState([]);            /* 后端 annotations（GET 加载） */
  const [history]=useState(HIST0);
  const [pulseNoteId,setPulseNoteId]=useState(null);
  const [diffEntry,setDiffEntry]=useState(null);
  const [selectedNotes,setSelectedNotes]=useState([]);
  const [rwOpen,setRwOpen]=useState(false);
  const [rwQuote,setRwQuote]=useState('');
  const [fbOpen,setFbOpen]=useState(false);       /* 面板反馈弹层（⌘/Ctrl+Shift+F）*/
  const [,setDocVer]=useState(0);                 /* bump → 重渲染读取刷新后的全局 REVIEW_MODEL */
  const bumpDoc=()=>setDocVer(v=>v+1);

  /* AnnoText 高亮源：从当前 notes 的结构化锚点派生（替代 mock NOTE_ANCHORS） */
  window.NOTE_HIGHLIGHTS=buildNoteHighlights(notes);

  const mainRef=useRef(null), scrollRef=useRef(null), saveTimer=useRef(null);
  /* mutated（agent 落盘）→ 重拉 extract 重渲染，与 rewrite-apply / 顶栏刷新共用同一入口 */
  const refreshAfterMutation=async()=>{
    if(!sessionId) return;
    try{ await fetchReviewUpdate(sessionId, doc); bumpDoc(); }catch(_){}
  };
  const agent=useRef(null);
  if(!agent.current) agent.current=sessionId?createRealAgent(sessionId, refreshAfterMutation):createMockAgent();
  const cancelAgent=useRef(null);

  /* ── 首屏加载：批注 / 拍板（刷新后仍在）── */
  useEffect(()=>{
    if(!sessionId) return;
    getAnnotations(sessionId).then(r=>setNotes((r.annotations||[]).map(annotationToNote))).catch(()=>{});
    getSignoffs(sessionId).then(r=>setSignoffs(r.signoffs||[])).catch(()=>{});
  },[]);

  /* ── hooks：跳转总线 / scroll-spy / 选区 ── */
  const { backStack, goBack }=useJumpBus(scrollRef);
  const { tool, setTool, savedRange, wrapSelection }=useDocSelection(mainRef);
  const { activeSec, seenSecs, progress }=useScrollSpy(scrollRef, REVIEW_MODEL.sections, ()=>setTool(null));

  /* ── 保存态 ── */
  function touchDoc(){
    setSaveState('saving');
    clearTimeout(saveTimer.current);
    saveTimer.current=setTimeout(()=>setSaveState('saved'),1400);
  }
  async function refresh(){
    if(!sessionId){ flash('离线示例数据，无法同步'); return; }
    setSpin(true); setSaveState('synced');
    try{ await fetchReviewUpdate(sessionId, doc); bumpDoc(); flash('已同步到最新版本'); }
    catch(e){ flash('同步失败：'+((e&&e.message)||e)); }
    finally{ setSpin(false); setSaveState('saved'); }
  }
  const saveLabel={ saved:'已保存', saving:'更新中…', synced:'已同步' }[saveState];

  /* ── 完成审阅 · 交付：合上 --wait 的 agent 审阅闸（终态动作，二次确认 + 交付后收尾）── */
  const deliverBtn=deliverButton(delivery, !!sessionId);
  async function onDeliver(){
    if(deliverBtn.disabled) return;
    if(!window.confirm('确定完成审阅并交付？--wait 的 agent 会据此拿回当前批准稿继续，交付不可撤销。')) return;
    setDelivery(d=>deliverTransition(d,'start'));
    try{
      await postDone(sessionId, window.REVIEW_DOC_SOURCE);
      setDelivery(d=>deliverTransition(d,'ok'));
      flash('已交付，agent 可继续');
    }catch(e){
      setDelivery(d=>deliverTransition(d,'fail'));
      flash('交付失败：'+((e&&e.message)||e));
    }
  }

  /* ── 面板反馈：提交时自动打包现场信息（用户只写一句话 + 选分类）──
     dom 只截审阅内容主容器 #docText 的 outerHTML（buildFeedbackPayload 内再按上限截断），
     不截整个 body / documentElement，避免打爆请求体。console 从早期环形缓冲读最近 N 条。 */
  async function submitFeedback(text, category){
    const docEl=document.getElementById('docText');
    const dom=docEl?docEl.outerHTML:undefined;
    const consoleErrors=typeof window.__recentConsoleErrors==='function'?window.__recentConsoleErrors():undefined;
    const viewport=`${window.innerWidth}x${window.innerHeight}`;
    const payload=buildFeedbackPayload(text, category, sessionId||undefined, dom, consoleErrors, viewport, activeSec);
    try{
      await postFeedback(payload);
      setFbOpen(false);
      flash('反馈已提交，谢谢');
    }catch(e){
      flash('反馈提交失败：'+((e&&e.message)||e));
    }
  }

  /* ── 会话管理 ── */
  useEffect(()=>{ setSessions(ss=>ss.map(s=>s.id===activeSid?{...s,msgs:messages}:s)); },[messages]);
  function stopAgent(){ if(cancelAgent.current){ cancelAgent.current(); cancelAgent.current=null; } setThinking(null); }
  function pickSession(id){ const s=sessions.find(x=>x.id===id); if(!s) return; stopAgent(); setActiveSid(id); setMessages(s.msgs); setSelCtx(null); }
  function newSession(){ const id='s'+Date.now(); stopAgent(); setSessions(ss=>[{id,title:'新会话',time:'刚刚',msgs:[]},...ss]); setActiveSid(id); setMessages([]); setSelCtx(null); }

  /* ── AI：所有请求走 AgentService ── */
  function askAgent(userMsg, req, after){
    setMessages(ms=>[...ms,userMsg]);
    if(cancelAgent.current) cancelAgent.current();
    cancelAgent.current=agent.current.send(req,{
      onThinking:setThinking,
      onReply:(msg)=>{ cancelAgent.current=null; setMessages(ms=>[...ms,{role:'ai',...msg}]); if(after) after(); },
    });
  }
  function onSend(text){
    const quote=selCtx; setSelCtx(null);
    const utext=text||(quote?'针对选中内容优化一下':'');
    /* chat 不改文档；selection-op 若改了文档由 createRealAgent 的 onMutated 重拉 extract。 */
    askAgent({role:'user',text:utext,...(quote?{quote}:{})},
      {type:'chat',text:utext,quote});
  }
  function moreEdit(m){
    setTool(null);
    const text=savedRange.current?.toString().trim().slice(0,40);
    if(m.id!=='explain') touchDoc();
    askAgent({role:'user',text:SEL_OP_TEXT[m.id]+(text?`：「${text}…」`:'')},
      {type:'selection-op',op:m.id,quote:text});
  }
  function runCmd(it){
    setCmdk(false);
    if(it.sec){ setTimeout(()=>scrollToSec(it.sec),60); flash('已定位到'+it.title.replace('跳到','')); return; }
    setChatOpen(true);
    askAgent({role:'user',text:it.title},{type:'command',id:it.id});
  }

  /* ── 批注（后端 annotations 为真源；草稿未存 body 前不落盘）── */
  function persistNotes(list){
    if(!sessionId) return;
    postAnnotations(sessionId, list.filter(n=>!n.draft).map(noteToAnnotation)).catch(()=>flash('批注保存失败'));
  }
  const updateNote=(id,patch)=>setNotes(ns=>{
    const next=ns.map(n=>n.id===id?{...n,...patch}:n);
    if(patch.draft===false) persistNotes(next);   /* 草稿转正式 → 落盘 */
    return next;
  });
  const resolveNote=(id)=>setNotes(ns=>{
    const next=ns.map(n=>n.id===id?{...n,status:n.status==='done'?'open':'done'}:n);
    persistNotes(next);
    return next;
  });
  const toggleSign=(l)=>{
    const next=toggleSignoff(signoffs, l);
    setSignoffs(next);                             /* 乐观更新 */
    if(sessionId) postSignoffs(sessionId, next).catch(()=>{ flash('拍板保存失败'); getSignoffs(sessionId).then(r=>setSignoffs(r.signoffs||[])).catch(()=>{}); });
  };
  const toggleNoteSel=(id)=>setSelectedNotes(s=>s.includes(id)?s.filter(x=>x!==id):[...s,id]);

  function addAnnotation(){
    const range=savedRange.current; const sel=(range?range.toString():'').trim(); setTool(null);
    if(!sel){ flash('请重新选中一段文字'); return; }
    const label=ptLabelOfRange(range);
    const anchor=buildSelectionAnchor(sel, label);
    if(!anchor){ flash('无法定位到原文，请重新选中'); return; }
    const id='n'+Date.now();
    const span=wrapSelection();
    if(span){ span.className='anno-mark'; span.dataset.note=id; }
    setNotes(ns=>[{ id, who:'我', color:'#5b57d6', time:'刚刚', pt:label||null, kind:label?pointKindOf(label):undefined,
      quote:sel.slice(0,40), body:'', status:'open', draft:true, anchor, createdAt:new Date().toISOString() },...ns]);
    setRightOpen(true); setRightTab('notes'); pulse(id);
    flash('已添加批注，在右栏输入内容');
  }
  function pulse(id){ setPulseNoteId(id); setTimeout(()=>setPulseNoteId(null),1800); }
  /* 点原文高亮 → 打开批注 tab 并脉冲卡片 */
  useEffect(()=>{
    function onClick(e){ const m=e.target.closest('.anno-mark'); if(!m) return;
      setRightOpen(true); setRightTab('notes'); pulse(m.dataset.note); }
    document.addEventListener('click',onClick);
    return ()=>document.removeEventListener('click',onClick);
  },[]);
  /* 点批注卡 → 定位原文高亮 */
  function focusAnno(n){
    setTimeout(()=>{
      const el=document.querySelector(`.anno-mark[data-note="${n.id}"]`);
      const sc=scrollRef.current;
      if(el&&sc){ scrollToEl(sc,el,140); flashElement(el,'pulse',1800); }
    },70);
  }
  function analyzeNotes(){
    const chosen = selectedNotes.length ? notes.filter(n=>selectedNotes.includes(n.id)) : notes.filter(n=>n.status!=='done');
    if(!chosen.length){ flash('没有可分析的批注'); return; }
    setChatOpen(true); setSelectedNotes([]);
    const list=chosen.map(n=>`· ${n.pt?`[${n.pt}] `:''}${n.who}：「${n.quote}」${n.body?' —— '+n.body:''}`).join('\n');
    /* AgentNote 契约 = { pt?, text? }（loose）：只送后端消费的字段。 */
    askAgent({role:'user',text:`把这 ${chosen.length} 条批注一起分析讨论：\n${list}`},
      {type:'analyze-notes',notes:chosen.map(n=>({ pt:n.pt||undefined, text:n.body||n.quote }))});
  }

  /* ── 历史 diff：原文内嵌 ── */
  function showDiff(h){
    setDiffEntry(h);
    if(!h) return;
    setTimeout(()=>{
      const el=document.querySelector('[data-diff-inline]');
      const sc=scrollRef.current;
      if(el&&sc) scrollToEl(sc,el,90);
    },80);
  }

  /* ── 内联 AI 改写：选区 → 源锚点换算 → rewrite-apply 落盘 → 重拉 extract 重渲染 ── */
  async function doRewrite(constraint){
    setRwOpen(false);
    const range=savedRange.current; const sel=(range?range.toString():'').trim(); setTool(null);
    if(!sel){ flash('请重新选中一段文字'); return; }
    if(!sessionId){ flash('离线示例数据，无法改写'); return; }
    const label=ptLabelOfRange(range);
    const anchor=pointAnchorOf(label);
    if(!anchor){ flash('这段无法定位到原文锚点，请选其他段落'); return; }
    const src=window.REVIEW_DOC_SOURCE||'';
    const r=computeSrcRange(sel,{ srcStart:anchor.srcStart, srcEnd:anchor.srcEnd, text:src.slice(anchor.srcStart,anchor.srcEnd) });
    touchDoc();
    try{
      const res=await postRewriteApply(sessionId,[{ id:label, srcStart:r.srcStart, srcEnd:r.srcEnd, selection:r.selection, instruction:constraint||'' }]);
      applyReviewUpdate(res.result, res.content, doc); bumpDoc();
      flash(constraint?`已按约束改写：${constraint.slice(0,16)}${constraint.length>16?'…':''}`:'已改写并落盘');
    }catch(e){
      if(e&&e.status===409){ flash('文档已变，请刷新重试'); await refreshAfterMutation(); }
      else flash('改写失败：'+((e&&e.message)||e));
    }
  }

  /* ── 定位 / 行动卡 / 快捷键 / 空白收起右栏 ── */
  function scrollToSec(id){ const el=document.querySelector(`[data-sec="${id}"]`); const sc=scrollRef.current; if(el&&sc) sc.scrollTo({top:el.offsetTop-16,behavior:'smooth'}); }
  function onAct(a){
    if(a.pt) setTimeout(()=>jumpTo(a.pt),60);
    else if(a.sec) setTimeout(()=>scrollToSec(a.sec),60);
  }
  useEffect(()=>{
    function onKey(e){
      const meta=e.metaKey||e.ctrlKey;
      if(meta&&e.shiftKey&&(e.key==='F'||e.key==='f')){e.preventDefault();setFbOpen(v=>!v);}
      else if(meta&&e.key==='k'){e.preventDefault();setCmdk(v=>!v);}
      else if(meta&&e.key==='\\'){e.preventDefault();setChatOpen(v=>!v);}
      else if(meta&&e.key===','){e.preventDefault();setSettingsOpen(v=>!v);}
      else if(e.key==='Escape'){setTool(null);setFbOpen(false);}
    }
    window.addEventListener('keydown',onKey);
    return ()=>window.removeEventListener('keydown',onKey);
  },[]);
  function onDocClick(e){
    if(!rightOpen) return;
    if(e.target.closest('.refchip')||e.target.closest('.seltool')||e.target.closest('.backpill')||e.target.closest('.anno-mark')||e.target.closest('button')) return;
    const sel=window.getSelection();
    if(sel && !sel.isCollapsed) return;
    setRightOpen(false);
  }

  return (
    <div className={`app${chatOpen?'':' chat-closed'}${rightOpen?'':' right-closed'}${delivered?' delivered':''}`}>
      <header className="topbar">
        <div className="tb-logo"><span className="mark">{I.sparkF}</span>Spec</div>
        <div className="tb-div"></div>
        <div className="tb-crumb"><span className="proj">{REVIEW_MODEL.meta.project}</span><span className="sep">/</span><span>docs / {REVIEW_MODEL.meta.file}</span></div>
        <div className="savepill" data-st={saveState}><span className="d"></span>{saveLabel}{REVIEW_MODEL.meta.status?` · ${REVIEW_MODEL.meta.status}`:''}</div>
        <button className={`tb-btn tb-refresh${spin?' spin':''}`} title="同步 / 刷新" onClick={refresh}>{I.refresh}</button>
        <button className={`tb-deliver${deliverBtn.done?' done':''}`} title="完成审阅并把批准稿交付给 --wait 的 agent"
          disabled={deliverBtn.disabled} onClick={onDeliver}>{I.check}<span className="an">{deliverBtn.label}</span></button>
        <div className="tb-spacer"></div>
        <button className="tb-btn kbd" onClick={()=>setCmdk(true)}>{I.search}<kbd>⌘K</kbd></button>
        <button className="tb-agent" title="配置 Agent" onClick={()=>setAgentOpen(true)}>
          <span className="bi">{I.bot}</span><span className="an">Spec AI</span>
          <span className="am">{AGENT_CLIS.find(c=>c.id===agentCfg.cli).short}</span><span className="chev">{I.down}</span>
        </button>
        <button className="tb-btn theme-ic" title="切换深色 / 浅色" onClick={toggleTheme}><span className="sun">{I.sun}</span><span className="moon">{I.moon}</span></button>
        <button className="tb-btn" title="设置 ⌘," onClick={()=>setSettingsOpen(true)}>{I.gear}</button>
      </header>

      {chatOpen && <ChatPanel messages={messages} thinking={thinking} selCtx={selCtx}
        clearSel={()=>setSelCtx(null)} onSend={onSend} onClose={()=>setChatOpen(false)} onAct={onAct}
        sessions={sessions} activeSid={activeSid} onPickSession={pickSession} onNewSession={newSession}
        modelShort={AGENT_CLIS.find(c=>c.id===agentCfg.cli).short} onOpenAgent={()=>setAgentOpen(true)}/>}

      <main className="main" ref={mainRef}>
        <div className="readbar" style={{width:`${Math.round(progress*100)}%`}}></div>
        {!chatOpen && <button className="chat-reopen" title="打开对话" onClick={()=>setChatOpen(true)}>{I.chat}</button>}
        <button className={`panel-dock${rightOpen?' open':''}`} title={rightOpen?'收起侧面板':'展开侧面板'} onClick={()=>setRightOpen(v=>!v)}>{I.panelRight}</button>
        <div className="doc-scroll" ref={scrollRef} onClick={onDocClick}>
          <DocView signed={signed} toggleSign={toggleSign} diffEntry={diffEntry}/>
        </div>
        {diffEntry&&(
          <div className="diffbar">
            {I.history}
            <span><b>{diffEntry.desc[0]}{diffEntry.desc[1]?' '+diffEntry.desc[1]:''}</b> · {diffEntry.time}</span>
            <button className="x" onClick={()=>setDiffEntry(null)}>退出查看</button>
          </div>
        )}
        {backStack.length>0&&<button className="backpill" onClick={goBack}>{I.send}返回跳转前的位置</button>}
        {tool && !delivered && <SelToolbar pos={tool}
          onRefine={()=>{ setSelCtx(tool.text.slice(0,60)); setTool(null); setChatOpen(true); }}
          onRewrite={()=>{ setRwQuote(tool.text); setRwOpen(true); }}
          onAnnotate={addAnnotation}
          onMore={moreEdit}
          more={filterSelMoreForDocKind(SEL_MORE, REVIEW_MODEL.docKind)}/>}
      </main>

      {rwOpen && <RewriteModal quote={rwQuote} onClose={()=>setRwOpen(false)} onConfirm={doRewrite}/>}

      {rightOpen && <RightPanel tab={rightTab} setTab={setRightTab}
        scrollTo={(id)=>setTimeout(()=>scrollToSec(id),40)}
        signed={signed} seenSecs={seenSecs}
        notes={notes} onResolveNote={resolveNote} onUpdateNote={updateNote} onFocusNote={focusAnno} pulseNoteId={pulseNoteId}
        selectedNotes={selectedNotes} onToggleNoteSel={toggleNoteSel} onAnalyzeNotes={analyzeNotes}
        history={history} diffEntry={diffEntry} onShowDiff={showDiff}/>}

      {fbOpen && <FeedbackPopover onClose={()=>setFbOpen(false)} onSubmit={submitFeedback}/>}
      {cmdk && <CmdK cmds={filterCommandsForDocKind(CMDS, REVIEW_MODEL.docKind)} onClose={()=>setCmdk(false)} onRun={runCmd}/>}
      {agentOpen && <AgentConfig cfg={agentCfg} onSave={(c)=>{ setAgentCfg(c); flash('Agent 接入已保存'); }} onClose={()=>setAgentOpen(false)}/>}
      {settingsOpen && <SettingsModal s={settings} setS={setSettings} onClose={()=>setSettingsOpen(false)}/>}
      {toast && <div className="toast">{I.check}{toast}</div>}
    </div>
  );
}

/* ═══ 数据加载：live fetch → adaptExtract → buildReviewModel → 渲染 ═══
   默认跟随服务器启动时打开的文档（GET /api/session）；?doc= 显式覆盖打开指定文档 →
   GET extract + file → 写入全局 REVIEW_MODEL / REVIEW_DOC_SOURCE（App 只读它们）。fetch / 派生 /
   互转都在 review-net.jsx（后端接线层）。loading / error 用 React state（无构建环境）；
   error 提供重试 + 离线 fixture 兜底（sessionId=null，仅只读浏览，写路径提示离线）。 */
function ReviewBoot({ status, message, onRetry, onOffline }){
  return (
    <div style={{ display:'grid', placeItems:'center', height:'100vh', fontFamily:'var(--sans)', color:'var(--fg)' }}>
      <div style={{ textAlign:'center', maxWidth:460, padding:'0 24px' }}>
        {status==='loading'
          ? <div style={{ opacity:.7 }}>正在加载 plan 文档…</div>
          : <>
              <div style={{ fontSize:18, fontWeight:600, marginBottom:8 }}>加载失败</div>
              <div style={{ opacity:.7, marginBottom:16, fontSize:13, wordBreak:'break-word' }}>{message}</div>
              <button onClick={onRetry} style={{ padding:'6px 14px', cursor:'pointer' }}>重试</button>
              {onOffline&&<button onClick={onOffline} style={{ padding:'6px 14px', marginLeft:8, cursor:'pointer' }}>用离线示例数据</button>}
            </>}
      </div>
    </div>
  );
}

const reviewRoot=ReactDOM.createRoot(document.getElementById('root'));
async function bootstrapReview(){
  reviewRoot.render(<ReviewBoot status="loading"/>);
  const requested=new URLSearchParams(location.search).get('doc');
  let sessionId, doc;
  try {
    if(requested){                                /* ?doc= 覆盖：显式打开指定文档（多文档）*/
      ({ sessionId }=await openReviewSession(requested)); doc=requested;
    } else {                                      /* 默认：跟随服务器启动时打开的文档 */
      const s=await getCurrentSession(); sessionId=s.id; doc=s.fileName;
    }
    await fetchReviewUpdate(sessionId, doc);        /* 写入 window.REVIEW_MODEL + REVIEW_DOC_SOURCE */
    reviewRoot.render(<App sessionId={sessionId} doc={doc}/>);
  } catch(e){
    const onOffline=window.REVIEW_FALLBACK_SOURCE
      ? ()=>{ window.REVIEW_MODEL=buildReviewModel(window.REVIEW_FALLBACK_SOURCE); reviewRoot.render(<App sessionId={null} doc={doc||''}/>); }
      : null;
    reviewRoot.render(<ReviewBoot status="error" message={String((e&&e.message)||e)} onRetry={bootstrapReview} onOffline={onOffline}/>);
  }
}
bootstrapReview();

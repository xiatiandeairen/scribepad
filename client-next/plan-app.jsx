/* ═══ Spec Plan — App 外壳 ═══
   组合：顶栏 / 对话（ChatPanel）/ 文档（DocView）/ 右栏（RightPanel）。
   跨模块逻辑都收敛在 hooks（plan-hooks.jsx）与 AgentService（agent-service.jsx）；
   本文件只做状态编排与事件接线。 */
const { useState, useRef, useEffect } = React;

const LS_SIGNED='spec-plan-signed';
const SEL_OP_TEXT={ dcard:'把这段转成决策卡', risk:'把这段提为风险项', open:'把这段提为待确认', explain:'解释这段' };

function App(){
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
  const [signed,setSigned]=usePersistedState(LS_SIGNED,[]);
  const [notes,setNotes]=useState(NOTES0);
  const [history]=useState(HIST0);
  const [pulseNoteId,setPulseNoteId]=useState(null);
  const [diffEntry,setDiffEntry]=useState(null);
  const [selectedNotes,setSelectedNotes]=useState([]);
  const [rwOpen,setRwOpen]=useState(false);
  const [rwQuote,setRwQuote]=useState('');

  const mainRef=useRef(null), scrollRef=useRef(null), saveTimer=useRef(null);
  const agent=useRef(null); if(!agent.current) agent.current=createMockAgent();
  const cancelAgent=useRef(null);

  /* ── hooks：跳转总线 / scroll-spy / 选区 ── */
  const { backStack, goBack }=useJumpBus(scrollRef);
  const { tool, setTool, savedRange, wrapSelection }=useDocSelection(mainRef);
  const { activeSec, seenSecs, progress }=useScrollSpy(scrollRef, PLAN_MODEL.sections, ()=>setTool(null));

  /* ── 保存态 ── */
  function touchDoc(){
    setSaveState('saving');
    clearTimeout(saveTimer.current);
    saveTimer.current=setTimeout(()=>setSaveState('saved'),1400);
  }
  function refresh(){ setSpin(true); setSaveState('synced'); setTimeout(()=>{ setSpin(false); setSaveState('saved'); flash('已同步到最新版本'); },900); }
  const saveLabel={ saved:'已保存', saving:'更新中…', synced:'已同步' }[saveState];

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
    askAgent({role:'user',text:utext,...(quote?{quote}:{})},
      {type:'chat',text:utext,quote},
      ()=>{ touchDoc(); flash('plan 已更新'); });
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

  /* ── 批注 ── */
  const updateNote=(id,patch)=>setNotes(ns=>ns.map(n=>n.id===id?{...n,...patch}:n));
  const resolveNote=(id)=>setNotes(ns=>ns.map(n=>n.id===id?{...n,status:n.status==='done'?'open':'done'}:n));
  const toggleSign=(l)=>setSigned(s=>s.includes(l)?s.filter(x=>x!==l):[...s,l]);
  const toggleNoteSel=(id)=>setSelectedNotes(s=>s.includes(id)?s.filter(x=>x!==id):[...s,id]);

  function addAnnotation(){
    const range=savedRange.current; const quote=(range?range.toString():'').trim(); setTool(null);
    if(!quote){ flash('请重新选中一段文字'); return; }
    const id='n'+Date.now();
    const span=wrapSelection();
    if(span){ span.className='anno-mark'; span.dataset.note=id; }
    setNotes(ns=>[{ id, who:'周衍', color:'#7a6ad0', time:'刚刚', pt:null, quote:quote.slice(0,40), body:'', status:'open', draft:true },...ns]);
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
    askAgent({role:'user',text:`把这 ${chosen.length} 条批注一起分析讨论：\n${list}`},
      {type:'analyze-notes',notes:chosen},
      ()=>flash(`已分析 ${chosen.length} 条批注`));
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

  /* ── 内联 AI 改写（演示：高亮动画，语义不变）── */
  function doRewrite(constraint){
    setRwOpen(false);
    const span=wrapSelection(); setTool(null);
    if(!span){ flash('请重新选中一段文字'); return; }
    const orig=span.textContent;
    setTimeout(()=>{
      span.className='ai-added';
      span.textContent=orig;
      requestAnimationFrame(()=>{ span.classList.add('settle'); });
      setTimeout(()=>{ if(span.parentNode){ const p=span.parentNode; while(span.firstChild) p.insertBefore(span.firstChild,span); p.removeChild(span);} },1400);
      touchDoc(); flash(constraint?`已按约束改写：${constraint.slice(0,16)}${constraint.length>16?'…':''}`:'已改写选中段落');
    },950);
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
      if(meta&&e.key==='k'){e.preventDefault();setCmdk(v=>!v);}
      else if(meta&&e.key==='\\'){e.preventDefault();setChatOpen(v=>!v);}
      else if(meta&&e.key===','){e.preventDefault();setSettingsOpen(v=>!v);}
      else if(e.key==='Escape'){setTool(null);}
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
    <div className={`app${chatOpen?'':' chat-closed'}${rightOpen?'':' right-closed'}`}>
      <header className="topbar">
        <div className="tb-logo"><span className="mark">{I.sparkF}</span>Spec</div>
        <div className="tb-div"></div>
        <div className="tb-crumb"><span className="proj">{PLAN_MODEL.meta.project}</span><span className="sep">/</span><span>docs / {PLAN_MODEL.meta.file}</span></div>
        <div className="savepill" data-st={saveState}><span className="d"></span>{saveLabel} · {PLAN_MODEL.meta.status}</div>
        <button className={`tb-btn tb-refresh${spin?' spin':''}`} title="同步 / 刷新" onClick={refresh}>{I.refresh}</button>
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
        {tool && <SelToolbar pos={tool}
          onRefine={()=>{ setSelCtx(tool.text.slice(0,60)); setTool(null); setChatOpen(true); }}
          onRewrite={()=>{ setRwQuote(tool.text); setRwOpen(true); }}
          onAnnotate={addAnnotation}
          onMore={moreEdit}/>}
      </main>

      {rwOpen && <RewriteModal quote={rwQuote} onClose={()=>setRwOpen(false)} onConfirm={doRewrite}/>}

      {rightOpen && <RightPanel tab={rightTab} setTab={setRightTab}
        scrollTo={(id)=>setTimeout(()=>scrollToSec(id),40)}
        signed={signed} seenSecs={seenSecs}
        notes={notes} onResolveNote={resolveNote} onUpdateNote={updateNote} onFocusNote={focusAnno} pulseNoteId={pulseNoteId}
        selectedNotes={selectedNotes} onToggleNoteSel={toggleNoteSel} onAnalyzeNotes={analyzeNotes}
        history={history} diffEntry={diffEntry} onShowDiff={showDiff}/>}

      {cmdk && <CmdK cmds={CMDS} onClose={()=>setCmdk(false)} onRun={runCmd}/>}
      {agentOpen && <AgentConfig cfg={agentCfg} onSave={(c)=>{ setAgentCfg(c); flash('Agent 接入已保存'); }} onClose={()=>setAgentOpen(false)}/>}
      {settingsOpen && <SettingsModal s={settings} setS={setSettings} onClose={()=>setSettingsOpen(false)}/>}
      {toast && <div className="toast">{I.check}{toast}</div>}
    </div>
  );
}

/* ═══ 数据加载：live fetch → adaptExtract → buildPlanModel → 渲染 ═══
   启动 POST /api/sessions/open 打开目标 plan（?doc= 可覆盖，默认 plan-data-backend.md）→
   GET /api/sessions/:id/extract → 派生 PLAN_MODEL（写入全局，App 只读它）。
   loading / error 用 React state（无构建环境）；error 提供重试 + 离线 fixture 兜底。 */
async function fetchJson(method,url,body){
  const res=await fetch(url,{ method,
    headers: body?{ 'content-type':'application/json' }:undefined,
    body: body?JSON.stringify(body):undefined });
  if(!res.ok){
    let msg=res.status+' '+res.statusText;
    try{ const e=await res.json(); if(e&&e.error) msg=e.error; }catch(_){}
    throw new Error(msg);
  }
  return res.json();
}
async function loadPlanModel(){
  const doc=new URLSearchParams(location.search).get('doc')||'plan-data-backend.md';
  const opened=await fetchJson('POST','/api/sessions/open',{ filePath:doc });
  const { result }=await fetchJson('GET',`/api/sessions/${encodeURIComponent(opened.sessionId)}/extract`);
  return buildPlanModel(adaptExtract(result,{ project:'scribepad', file:doc.split('/').pop() }));
}

function PlanBoot({ status, message, onRetry, onOffline }){
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

const planRoot=ReactDOM.createRoot(document.getElementById('root'));
function mountApp(model){ window.PLAN_MODEL=model; planRoot.render(<App/>); }
async function bootstrapPlan(){
  planRoot.render(<PlanBoot status="loading"/>);
  try {
    mountApp(await loadPlanModel());
  } catch(e){
    const onOffline=window.PLAN_FALLBACK_SOURCE
      ? ()=>mountApp(buildPlanModel(window.PLAN_FALLBACK_SOURCE))
      : null;
    planRoot.render(<PlanBoot status="error" message={String((e&&e.message)||e)} onRetry={bootstrapPlan} onOffline={onOffline}/>);
  }
}
bootstrapPlan();

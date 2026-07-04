/* ═══════════════ Spec — Chat panel ═══════════════ */
const { useState:useStateCh, useRef:useRefCh, useEffect:useEffectCh } = React;

function ActChip({ a, onGo }){
  return <div className="act" onClick={onGo}>
    <span className={`ai ${a.kind}`}>{I[a.icon]}</span>
    <span className="tx"><b>{a.title}</b><span>{a.sub}</span></span>
    <span className="go">{I.arrow}</span>
  </div>;
}

function SessionMenu({ sessions, activeSid, onPick, onNew, close }){
  return (
    <div className="sess-menu" onMouseDown={e=>e.stopPropagation()}>
      <div className="smh"><span>会话记录</span><button className="new" onClick={()=>{onNew();close();}}>{I.plus}新建会话</button></div>
      <div className="sess-list">
        {sessions.map(s=><div key={s.id} className={`sess-it${s.id===activeSid?' on':''}`} onClick={()=>{onPick(s.id);close();}}>
          <span className="si">{I.chat}</span>
          <span className="st"><b>{s.title}</b><span>{s.time} · {s.msgs.length} 条消息</span></span>
          {s.id===activeSid && <span className="dotc"></span>}
        </div>)}
      </div>
    </div>
  );
}

function ChatPanel({ messages, thinking, selCtx, clearSel, onSend, onClose, onAct, sessions, activeSid, onPickSession, onNewSession, modelShort, onOpenAgent }){
  const [val,setVal]=useStateCh('');
  const [menu,setMenu]=useStateCh(false);
  const scrollRef=useRefCh(null);
  const taRef=useRefCh(null);
  const active=sessions.find(s=>s.id===activeSid);
  useEffectCh(()=>{ if(scrollRef.current) scrollRef.current.scrollTop=scrollRef.current.scrollHeight; },[messages,thinking]);
  useEffectCh(()=>{ if(selCtx&&taRef.current) taRef.current.focus(); },[selCtx]);
  useEffectCh(()=>{ if(!menu) return; const h=()=>setMenu(false); window.addEventListener('mousedown',h); return ()=>window.removeEventListener('mousedown',h); },[menu]);

  function grow(e){ e.target.style.height='auto'; e.target.style.height=Math.min(120,e.target.scrollHeight)+'px'; setVal(e.target.value); }
  function submit(){ const t=val.trim(); if(!t&&!selCtx) return; onSend(t); setVal(''); if(taRef.current) taRef.current.style.height='auto'; }

  return (
    <aside className="chat">
      <div className="chat-head">
        <div className="sess-wrap">
          <button className="sess-btn" onMouseDown={e=>{e.stopPropagation();setMenu(m=>!m);}}>
            <span className="spark">{I.spark}</span>
            <span className="nm">{active?active.title:'新会话'}</span>
            <span className="chev">{I.down}</span>
          </button>
          {menu && <SessionMenu sessions={sessions} activeSid={activeSid} onPick={onPickSession} onNew={onNewSession} close={()=>setMenu(false)}/>}
        </div>
        <button className="ic newses" title="新建会话" onClick={onNewSession}>{I.plus}</button>
        <button className="ic" title="收起面板 ⌘\" onClick={onClose}>{I.panelLeft}</button>
      </div>

      {messages.length===0 && !thinking ? (
        <div className="chat-empty">
          <span className="big">{I.sparkF}</span>
          <h3>开始新的对话</h3>
          <p>描述你想梳理或修改的内容，我会直接编辑右侧的文档与画布。</p>
          <div className="sugg">
            {SUGG.map((s,i)=><button key={i} onClick={()=>onSend(s.text)}>{I[s.icon]}{s.text}</button>)}
          </div>
        </div>
      ) : (
        <div className="chat-scroll" ref={scrollRef}>
          {messages.map((m,i)=> m.role==='user'
            ? <div className="msg user" key={i}><div className="bubble">{m.quote&&<div className="quote" style={{margin:'0 0 6px'}}>“{m.quote}”</div>}{m.text}</div></div>
            : <div className="msg ai" key={i}>
                <div className="role"><span className="dot">{I.sparkF}</span>Spec AI</div>
                <div className="body">
                  {m.quote && <div className="quote">“{m.quote}”</div>}
                  {(m.body||[m.text]).map((p,j)=><p key={j}>{p}</p>)}
                  {m.acts && <div className="acts">{m.acts.map((a,j)=><ActChip key={j} a={a} onGo={()=>onAct(a)}/>)}</div>}
                </div>
              </div>
          )}
          {thinking && <div className="msg ai"><div className="role"><span className="dot">{I.sparkF}</span>Spec AI</div><div className="thinking"><span className="orb"></span>{thinking}</div></div>}
        </div>
      )}

      <div className="chat-input">
        {selCtx && <div className="selctx"><span className="q">“{selCtx}”</span><button className="x" onClick={clearSel}>{I.close}</button></div>}
        <div className="composer">
          <textarea ref={taRef} rows="1" placeholder={selCtx?'针对选中内容提问…':'描述你想要的修改，或 @ 引用文档…'} value={val}
            onChange={grow} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();submit();}}}/>
          <div className="composer-bar">
            <button className="mini" title="引用文档片段">{I.attach}</button>
            <button className="model" onClick={onOpenAgent} title="配置 Agent">{I.bot}{modelShort||'Sonnet 4.5'} {I.down}</button>
            <button className="send" disabled={!val.trim()&&!selCtx} onClick={submit}>{I.send}</button>
          </div>
        </div>
      </div>
    </aside>
  );
}
window.ChatPanel = ChatPanel;

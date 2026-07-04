/* ═══ Spec Plan — 浮层组件：选区工具条 / 改写约束弹窗 ═══ */
const { useState: useStateOv, useRef: useRefOv, useEffect: useEffectOv } = React;

/* 划选浮动工具条：细化 · 改写 · 批注 · 更多（转决策卡 / 提风险 / 提待确认 / 解释） */
function SelToolbar({ pos, onRefine, onRewrite, onAnnotate, onMore }){
  const [open,setOpen]=useStateOv(false);
  useEffectOv(()=>{ setOpen(false); },[pos]);
  return (
    <div className="seltool" style={{left:pos.x,top:pos.y}} onMouseDown={e=>e.preventDefault()}>
      <button className="primary" onClick={onRefine}>{I.chat}在对话中细化</button>
      <span className="div"></span>
      <button onClick={onRewrite}>{I.wand}改写</button>
      <button onClick={onAnnotate}>{I.note}批注</button>
      <span className="div"></span>
      <div className="more">
        <button onClick={()=>setOpen(o=>!o)}>{I.dots}</button>
        {open && <div className="selmenu">{SEL_MORE.map(m=><button key={m.id} onClick={()=>{setOpen(false);onMore(m);}}>{I[m.icon]}{m.label}<span className="k">{m.k}</span></button>)}</div>}
      </div>
    </div>
  );
}

/* 改写约束弹窗：输入约束 → 确认改写（语义不变） */
function RewriteModal({ quote, onClose, onConfirm }){
  const [val,setVal]=useStateOv('');
  const taRef=useRefOv(null);
  useEffectOv(()=>{ taRef.current&&taRef.current.focus(); },[]);
  const presets=['更简洁','更正式','补上标签引用','拆成要点','解释更清楚'];
  return (
    <div className="cmdk-back" onMouseDown={onClose}>
      <div className="rw-modal" onMouseDown={e=>e.stopPropagation()}>
        <div className="rw-head"><span className="ri">{I.wand}</span><div className="rt"><b>改写选中内容</b><span>描述约束，AI 按约束重写这段——语义不变</span></div><button className="x" onClick={onClose}>{I.close}</button></div>
        <div className="rw-quote">“{quote}”</div>
        <div className="rw-body">
          <textarea ref={taRef} rows="3" placeholder="例如：更简洁、保留 D3/G4 引用、去掉口语…" value={val}
            onChange={e=>setVal(e.target.value)} onKeyDown={e=>{ if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){ onConfirm(val); } }}/>
          <div className="rw-presets">{presets.map(p=><button key={p} onClick={()=>setVal(v=>v?v+'、'+p:p)}>{p}</button>)}</div>
        </div>
        <div className="rw-foot"><span className="hint">⌘↵ 确认</span><button className="cancel" onClick={onClose}>取消</button><button className="go" onClick={()=>onConfirm(val)}>{I.wand}确认改写</button></div>
      </div>
    </div>
  );
}

Object.assign(window,{ SelToolbar, RewriteModal });

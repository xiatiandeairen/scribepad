/* ═══ Spec DS — 共享外壳组件 ═══
   职责：设置（主题 + 阅读排版）、命令面板、Agent CLI 接入数据。
   数据依赖：无（自包含）。被 doc-app / code-app 消费。 */
const { useState: useStateDS, useRef: useRefDS, useEffect: useEffectDS } = React;

/* ─────────── Agent 接入（本地 CLI） ─────────── */
const AGENT_CLIS = [
  { id:'claude', name:'Claude Code', short:'claude -p', bin:'claude', ver:'2.1.24',
    desc:'Anthropic 官方 CLI · headless 模式（-p），流式输出与工具调用',
    cmd:(cwd)=>`claude -p --output-format stream-json \\\n  --add-dir ${cwd}` },
  { id:'codex', name:'Codex CLI', short:'codex', bin:'codex', ver:'0.48.0',
    desc:'OpenAI Codex CLI · 非交互执行（exec），JSON 事件流',
    cmd:(cwd)=>`codex exec --json \\\n  -C ${cwd}` },
];
const AGENT_DEFAULT = { cli:'claude', cwd:'~/work/order-service' };

/* ─────────── 设置：主题 + 阅读排版 ─────────── */
const SETTINGS_DEFAULT={ theme:'system', dsc:1, lh:1.72, font:'sans' };
const SERIF_STACK="Georgia,'Songti SC','Noto Serif SC',serif";
function loadSettings(){
  try{ const raw=localStorage.getItem('spec-settings'); if(raw) return {...SETTINGS_DEFAULT,...JSON.parse(raw)}; }catch(e){}
  return SETTINGS_DEFAULT;
}
function applySettings(s){
  const root=document.documentElement;
  const dark = s.theme==='dark' || (s.theme==='system' && window.matchMedia&&window.matchMedia('(prefers-color-scheme:dark)').matches);
  root.setAttribute('data-theme', dark?'dark':'light');
  root.style.setProperty('--dsc', s.dsc);
  root.style.setProperty('--doc-lh', s.lh);
  root.style.setProperty('--doc-font', s.font==='serif'?SERIF_STACK:'var(--sans)');
}
/* 应用 + 持久化 + 跟随系统，返回 {settings,setSettings,toggleTheme} */
function useSettings(){
  const [settings,setSettings]=useStateDS(loadSettings);
  useEffectDS(()=>{
    applySettings(settings);
    try{ localStorage.setItem('spec-settings',JSON.stringify(settings)); }catch(e){}
  },[settings]);
  useEffectDS(()=>{
    if(!window.matchMedia) return;
    const mq=window.matchMedia('(prefers-color-scheme:dark)');
    const on=()=>{ if(settings.theme==='system') applySettings(settings); };
    mq.addEventListener?.('change',on);
    return ()=>mq.removeEventListener?.('change',on);
  },[settings.theme]);
  function toggleTheme(){
    setSettings(s=>{
      const dark = s.theme==='dark' || (s.theme==='system' && window.matchMedia&&window.matchMedia('(prefers-color-scheme:dark)').matches);
      return {...s, theme: dark?'light':'dark'};
    });
  }
  return { settings, setSettings, toggleTheme };
}

function ThemePrev({ t }){
  if(t==='system') return (
    <div className="prev" style={{background:'#fff'}}>
      <div style={{position:'absolute',inset:0,clipPath:'polygon(100% 0,100% 100%,0 100%)',background:'#161619'}}></div>
      <div className="bar" style={{background:'#f2f2f2'}}></div>
      <div className="ln" style={{left:8,top:22,width:26,background:'#d9d9de'}}></div>
      <div className="ln" style={{left:8,top:31,width:18,background:'#e6e6e9'}}></div>
      <div className="ln" style={{right:8,bottom:9,width:22,background:'#3a3a42'}}></div>
    </div>);
  const dk=t==='dark';
  return (
    <div className="prev" style={{background:dk?'#161619':'#fff'}}>
      <div className="bar" style={{background:dk?'#232328':'#f2f2f2'}}></div>
      <div className="ln" style={{left:8,top:22,width:28,background:dk?'#3a3a42':'#d9d9de'}}></div>
      <div className="ln" style={{left:8,top:31,width:20,background:dk?'#2e2e35':'#e6e6e9'}}></div>
      <div className="ln" style={{left:8,top:40,width:24,background:dk?'#33333a':'#e6e6e9'}}></div>
    </div>);
}
function SettingsModal({ s, setS, onClose }){
  const upd=(k,v)=>setS(p=>({...p,[k]:v}));
  const themes=[['system','跟随系统','globe'],['light','浅色','sun'],['dark','深色','moon']];
  return (
    <div className="set-ov" onMouseDown={onClose}>
      <div className="set" onMouseDown={e=>e.stopPropagation()}>
        <div className="set-hd">
          <span className="si">{I.gear2}</span>
          <div className="st"><b>设置</b><span>外观与阅读偏好 · 更改自动保存</span></div>
          <button className="x" onClick={onClose}>{I.close}</button>
        </div>
        <div className="set-body">
          <div className="set-sec">
            <div className="sh">主题</div>
            <div className="theme-opts">
              {themes.map(([id,label,ic])=>(
                <div key={id} className={`theme-card${s.theme===id?' on':''}`} onClick={()=>upd('theme',id)}>
                  <ThemePrev t={id}/>
                  <div className="cap">{I[ic]}{label}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="set-sec">
            <div className="sh">阅读排版</div>
            <div className="set-row">
              <div className="rl"><b>正文字体</b><span>文档正文的字体族</span></div>
              <div className="seg-ctrl">
                <button className={s.font==='sans'?'on':''} onClick={()=>upd('font','sans')}>无衬线</button>
                <button className={s.font==='serif'?'on':''} onClick={()=>upd('font','serif')}>衬线</button>
              </div>
            </div>
            <div className="set-row">
              <div className="rl"><b>字号</b><span>正文基准字号</span></div>
              <div className="set-slider"><input type="range" min="0.85" max="1.3" step="0.05" value={s.dsc} onChange={e=>upd('dsc',+e.target.value)}/><span className="val">{Math.round(15*s.dsc)}px</span></div>
            </div>
            <div className="set-row">
              <div className="rl"><b>行距</b><span>正文行高倍数</span></div>
              <div className="set-slider"><input type="range" min="1.5" max="2.05" step="0.05" value={s.lh} onChange={e=>upd('lh',+e.target.value)}/><span className="val">{(+s.lh).toFixed(2)}</span></div>
            </div>
            <div className="set-prev"><p>订单服务在锁库存前先做风控评分：超过硬阈值直接拒绝下单，落入软阈值区间则转人工审核，避免风险单占用库存。</p></div>
          </div>
        </div>
        <div className="set-foot">
          <button className="reset" onClick={()=>setS({...SETTINGS_DEFAULT})}>恢复默认</button>
          <span className="sp"></span>
          <button className="done" onClick={onClose}>完成</button>
        </div>
      </div>
    </div>
  );
}

/* ─────────── 命令面板（命令列表由调用方注入） ─────────── */
function CmdK({ cmds, onClose, onRun }){
  const [q,setQ]=useStateDS('');
  const [idx,setIdx]=useStateDS(0);
  const inp=useRefDS(null);
  useEffectDS(()=>{ inp.current?.focus(); },[]);
  const flat=[]; cmds.forEach(g=>g.items.forEach(it=>{ if(!q||it.title.includes(q)||it.sub.includes(q)) flat.push(it); }));
  useEffectDS(()=>{ setIdx(0); },[q]);
  function key(e){
    if(e.key==='ArrowDown'){e.preventDefault();setIdx(i=>Math.min(flat.length-1,i+1));}
    else if(e.key==='ArrowUp'){e.preventDefault();setIdx(i=>Math.max(0,i-1));}
    else if(e.key==='Enter'){e.preventDefault(); if(flat[idx]) onRun(flat[idx]);}
    else if(e.key==='Escape'){onClose();}
  }
  let fi=-1;
  return (
    <div className="cmdk-back" onMouseDown={onClose}>
      <div className="cmdk" onMouseDown={e=>e.stopPropagation()}>
        <div className="cmdk-in">{I.search}<input ref={inp} placeholder="搜索命令、AI 操作、插入块…" value={q} onChange={e=>setQ(e.target.value)} onKeyDown={key}/><kbd>ESC</kbd></div>
        <div className="cmdk-list">
          {cmds.map((g,gi)=>{ const items=g.items.filter(it=>!q||it.title.includes(q)||it.sub.includes(q)); if(!items.length) return null;
            return <div key={gi}><div className="cmdk-grp">{g.grp}</div>{items.map((it)=>{ fi++; const ci=fi; return (
              <div key={it.id} className={`cmdk-it${ci===idx?' on':''}`} onMouseEnter={()=>setIdx(ci)} onClick={()=>onRun(it)}>
                <span className="ci">{I[it.icon]}</span><span className="tx"><b>{it.title}</b><span>{it.sub}</span></span>{it.k&&<span className="k">{it.k}</span>}
              </div>); })}</div>;
          })}
          {flat.length===0 && <div style={{padding:'22px',textAlign:'center',color:'var(--text-4)',fontSize:13}}>没有匹配的命令</div>}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { AGENT_CLIS, AGENT_DEFAULT, useSettings, SettingsModal, CmdK });

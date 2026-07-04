/* ═══ Spec Plan — 标签芯片 / 悬停预览 / 跳转总线 ═══
   <Ref l="G1"/>   可跳转标签芯片（悬停预览卡，点击跳转 + 闪烁高亮）
   <T s="…{G1}…"/> 把文本中的 {token} 渲染为芯片
   数据来源：PLAN_MODEL.points（plan-contract.jsx 派生）。 */
const { useState: useStateRef, useRef: useRefRef } = React;

const SEC_NAME = Object.fromEntries(SECTION_DEFS.map(s=>[s.id, `§${s.n} ${s.name}`]));

/* 跳转总线：任何模块 dispatch，plan-app 的 useJumpBus 负责滚动 + 高亮 */
function jumpTo(label){ window.dispatchEvent(new CustomEvent('plan-jump',{ detail:{ label } })); }

function RefPop({ meta, label, x, y, below }){
  const km=KIND_META[meta.kind]||KIND_META.sec;
  const cx=Math.min(Math.max(x,150), window.innerWidth-150);
  const style = below
    ? { left:cx, top:y+22, transform:'translateX(-50%)' }
    : { left:cx, top:y-8,  transform:'translate(-50%,-100%)' };
  return (
    <div className="refpop" style={style}>
      <div className="ph">
        <span className={`refchip ${km.cls}`}>{meta.chip||label}</span>
        <span className="kn">{km.name}</span>
        <span className="loc">{SEC_NAME[meta.sec]||''}</span>
      </div>
      <div className="pt1">{meta.title}</div>
      <div className="pb">{meta.brief}</div>
      <div className="pf">点击标签跳转到原文</div>
    </div>
  );
}

function Ref({ l }){
  const key=normLabel(l);
  const meta=PLAN_MODEL.points[key];
  const [pop,setPop]=useStateRef(null);
  const ref=useRefRef(null);
  if(!meta) return <code className="refchip s plain" title="未注册的标签（悬空引用）">{l}</code>;
  const km=KIND_META[meta.kind]||KIND_META.sec;
  function enter(){
    const r=ref.current.getBoundingClientRect();
    setPop({ x:r.left+r.width/2, y:r.top, below:r.top<190 });
  }
  return (
    <span className="refwrap" ref={ref} onMouseEnter={enter} onMouseLeave={()=>setPop(null)}>
      <button className={`refchip ${km.cls}`} onClick={(e)=>{ e.stopPropagation(); setPop(null); jumpTo(key); }}>{l}</button>
      {pop && <RefPop meta={meta} label={l} x={pop.x} y={pop.y} below={pop.below}/>}
    </span>
  );
}

/* 文本 token 渲染：切开 {…} 逐段渲染，非 token 段原样输出 */
function T({ s }){
  const parts=String(s).split(/(\{[^}]+\})/);
  return <>{parts.map((p,i)=> p.startsWith('{')&&p.endsWith('}') ? <Ref key={i} l={p.slice(1,-1)}/> : p)}</>;
}

Object.assign(window,{ SEC_NAME, jumpTo, Ref, T });

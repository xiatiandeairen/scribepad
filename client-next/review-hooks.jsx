/* ═══ Spec Plan — 通用 hooks ═══
   与业务无关的可复用逻辑：持久化 state / toast / 跳转总线 /
   scroll-spy + 阅读进度 / 文档选区。review-app.jsx 组合使用。 */
const { useState: useStateH, useRef: useRefH, useEffect: useEffectH, useCallback: useCallbackH } = React;

/* ── localStorage 持久化 state（读写失败静默降级为内存态）── */
function usePersistedState(key, initial){
  const [val,setVal]=useStateH(()=>{
    try{ const raw=localStorage.getItem(key); if(raw!=null) return JSON.parse(raw); }catch(_){}
    return typeof initial==='function' ? initial() : initial;
  });
  useEffectH(()=>{ try{ localStorage.setItem(key,JSON.stringify(val)); }catch(_){} },[key,val]);
  return [val,setVal];
}

/* ── toast：flash(msg) 弹出 2.2s 自动消失 ── */
function useToast(){
  const [toast,setToast]=useStateH(null);
  const timer=useRefH(null);
  const flash=useCallbackH((msg)=>{
    setToast(msg);
    clearTimeout(timer.current);
    timer.current=setTimeout(()=>setToast(null),2200);
  },[]);
  useEffectH(()=>()=>clearTimeout(timer.current),[]);
  return [toast,flash];
}

/* ── 元素闪烁高亮（跳转 / 批注定位共用）── */
function flashElement(el, cls, ms){
  document.querySelectorAll('.'+cls).forEach(x=>x.classList.remove(cls));
  void el.offsetWidth;
  el.classList.add(cls);
  setTimeout(()=>el.classList.remove(cls), ms||1750);
}

/* ── 滚动容器内定位到元素 ── */
function scrollToEl(sc, el, offset){
  const top=el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - (offset||110);
  sc.scrollTo({ top, behavior:'smooth' });
}

/* ── 标签跳转总线：review-jump 事件 → 定位 + 高亮 + 记录返回点 ──
   返回 { backStack, goBack }（返回胶囊消费）。 */
function useJumpBus(scrollRef){
  const [backStack,setBackStack]=useStateH([]);
  useEffectH(()=>{
    function onJump(e){
      const el=document.querySelector(`[data-pt="${CSS.escape(e.detail.label)}"]`);
      const sc=scrollRef.current;
      if(!el||!sc) return;
      setBackStack(st=>[...st.slice(-7), sc.scrollTop]);
      scrollToEl(sc, el);
      flashElement(el,'pt-flash');
    }
    window.addEventListener('review-jump',onJump);
    return ()=>window.removeEventListener('review-jump',onJump);
  },[]);
  const goBack=useCallbackH(()=>{
    const sc=scrollRef.current;
    setBackStack(st=>{
      if(!st.length) return st;
      if(sc) sc.scrollTo({ top:st[st.length-1], behavior:'smooth' });
      return st.slice(0,-1);
    });
  },[]);
  return { backStack, goBack };
}

/* ── scroll-spy + 阅读进度 + 小节已读集合 ── */
function useScrollSpy(scrollRef, sections, onScrollExtra){
  const [activeSec,setActiveSec]=useStateH(sections[0]&&sections[0].id);
  const [seenSecs,setSeenSecs]=useStateH(()=>new Set([sections[0]&&sections[0].id]));
  const [progress,setProgress]=useStateH(0);
  const extraRef=useRefH(onScrollExtra);
  extraRef.current=onScrollExtra;
  useEffectH(()=>{
    const sc=scrollRef.current; if(!sc) return;
    function onScroll(){
      if(extraRef.current) extraRef.current();
      const els=sections.map(s=>document.querySelector(`[data-sec="${s.id}"]`)).filter(Boolean);
      let cur=els[0]&&els[0].dataset.sec;
      for(const el of els){ if(el.getBoundingClientRect().top<170) cur=el.dataset.sec; }
      if(cur){ setActiveSec(cur); setSeenSecs(prev=>prev.has(cur)?prev:new Set([...prev,cur])); }
      const max=sc.scrollHeight-sc.clientHeight;
      setProgress(max>0?Math.min(1,sc.scrollTop/max):0);
    }
    sc.addEventListener('scroll',onScroll,{passive:true});
    return ()=>sc.removeEventListener('scroll',onScroll);
  },[sections]);
  return { activeSec, seenSecs, progress };
}

/* ── 文档正文选区：划选 → 工具条锚点 { x, y, text } ──
   返回 { tool, setTool, savedRange, wrapSelection }。
   wrapSelection() 把上次选区包进 span 并返回（AI 内联改写 / 批注共用）。 */
function useDocSelection(mainRef){
  const [tool,setTool]=useStateH(null);
  const savedRange=useRefH(null);
  useEffectH(()=>{
    function onUp(e){
      if(e.target.closest('.seltool')) return;
      setTimeout(()=>{
        const sel=window.getSelection();
        const docText=document.getElementById('docText');
        if(!sel||sel.isCollapsed||!docText){ setTool(null); return; }
        const range=sel.getRangeAt(0);
        if(!docText.contains(range.commonAncestorContainer)){ setTool(null); return; }
        const text=sel.toString().trim();
        if(text.length<2){ setTool(null); return; }
        const rect=range.getBoundingClientRect();
        const mr=mainRef.current.getBoundingClientRect();
        savedRange.current=range.cloneRange();
        setTool({ x:rect.left-mr.left+rect.width/2, y:rect.top-mr.top-8, text });
      },10);
    }
    document.addEventListener('mouseup',onUp);
    return ()=>document.removeEventListener('mouseup',onUp);
  },[]);
  const wrapSelection=useCallbackH(()=>{
    const range=savedRange.current; if(!range) return null;
    const span=document.createElement('span'); span.className='ai-editing';
    try{ range.surroundContents(span); }
    catch(_){ try{ const frag=range.extractContents(); span.appendChild(frag); range.insertNode(span);}catch(__){ return null; } }
    window.getSelection().removeAllRanges();
    return span;
  },[]);
  return { tool, setTool, savedRange, wrapSelection };
}

Object.assign(window,{ usePersistedState, useToast, flashElement, scrollToEl,
  useJumpBus, useScrollSpy, useDocSelection });

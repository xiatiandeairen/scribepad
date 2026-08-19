/* ═══ Spec Plan — AgentService（AI 能力的唯一出入口）═══
   UI 不直接编造 AI 回复；所有 AI 行为都经过这一个接口：

     agent.send(request, { onThinking, onReply }) → cancel()

   request（按来源分型）：
     { type:'chat',          text, quote? }            对话输入（可带选区引用）
     { type:'selection-op',  op, quote }               选区「更多」操作 op ∈ dcard|risk|open|explain
     { type:'analyze-notes', notes:[…] }               批注批量分析
     { type:'command',       id }                      命令面板 AI 命令 ai-review|ai-refs
   callbacks：
     onThinking(label)  过程态文案（可多次，null 表示结束思考）
     onReply(msg)       最终回复 { body:[段落], acts:[行动卡]?, quote? }

   progress 事件映射到 onThinking，final 映射到 onReply。 */

/* ═══ 真实 AgentService（接后端 SSE，UI 层零改动）═══ */

/* SSE 帧解析（纯函数，可单测）：把累积字节缓冲按 \n\n 切帧，每帧取 data: 行 join 后
   JSON.parse 成 AgentEvent；未闭合的尾帧留在 rest 待下个 chunk 拼接（跨 chunk 半帧安全）。 */
function parseSseChunk(buffer){
  const parts=String(buffer).split('\n\n');
  const rest=parts.pop();                         /* 末段可能是半帧，留待拼接 */
  const events=[];
  for(const frame of parts){
    const data=frame.split(/\r\n|\r|\n/)
      .filter(l=>l.indexOf('data:')===0)
      .map(l=>l.slice(5).replace(/^ /,''))
      .join('\n');
    if(!data) continue;
    try{ events.push(JSON.parse(data)); }catch(_){}  /* 非 JSON 帧（如 event:error 的纯文本）跳过 */
  }
  return { events, rest };
}

/* AgentEvent → 回调映射（纯函数，可单测）：progress→onThinking(label)；
   final→onThinking(null)+onReply({body,acts})，mutated 时触发 onMutated（重拉 extract 重渲染）。 */
function applyAgentEvent(ev, cb, onMutated){
  if(!ev||typeof ev!=='object') return;
  if(ev.type==='progress'){ cb.onThinking(ev.label); return; }
  if(ev.type==='final'){
    cb.onThinking(null);
    cb.onReply({ body:ev.paragraphs||[], acts:ev.actions||[] });
    if(ev.mutated&&onMutated) onMutated();
  }
}

/* 真实实现：POST /api/sessions/:id/agent，fetch + ReadableStream 消费 SSE。
   不用 EventSource——它只支持 GET，而 chat.text / analyze-notes.notes 要放 body。
   cancel() 用 AbortController abort fetch → 触发后端 stream.onAbort 取消（会话切换时被调用）。
   onMutated：final.mutated=true 时调用（dcard/risk/open 已改文档，需重拉 extract 重渲染）。 */
function createRealAgent(sessionId, onMutated){
  return {
    send(req, cb){
      const ctl=new AbortController();
      (async()=>{
        let res;
        try{
          res=await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/agent`,{
            method:'POST', signal:ctl.signal,
            headers:{ 'content-type':'application/json' },
            body:JSON.stringify(req) });
        }catch(e){
          if(!ctl.signal.aborted){ cb.onThinking(null); cb.onReply({ body:['AI 请求失败：'+((e&&e.message)||e)] }); }
          return;
        }
        if(!res.ok||!res.body){ cb.onThinking(null); cb.onReply({ body:['AI 请求失败（HTTP '+res.status+'）'] }); return; }
        const reader=res.body.getReader();
        const dec=new TextDecoder();
        let buf='';
        try{
          for(;;){
            const { value, done }=await reader.read();
            if(done) break;
            buf+=dec.decode(value,{ stream:true });
            const parsed=parseSseChunk(buf); buf=parsed.rest;
            for(const ev of parsed.events) applyAgentEvent(ev, cb, onMutated);
          }
        }catch(_){ /* abort / 断流：cancel 已由外部触发，不再回调 */ }
      })();
      return ()=>ctl.abort();
    },
  };
}

Object.assign(window,{ createRealAgent, parseSseChunk, applyAgentEvent });

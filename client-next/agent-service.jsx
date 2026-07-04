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

   接真实后端：实现同签名的对象替换 createMockAgent()（SSE / CLI 流式
   事件 → onThinking，最终消息 → onReply），UI 层零改动。见《接入说明.md》§4。 */

function createMockAgent(){

  /* 引用图统计（ai-refs 回复用，从模型层派生而非写死） */
  function refStats(){
    const labeled=Object.entries(PLAN_MODEL.points).filter(([,e])=>!['sec','acc'].includes(e.kind));
    const edges=Object.values(PLAN_MODEL.inbound).reduce((a,v)=>a+v.length,0);
    const hot=Object.entries(PLAN_MODEL.inbound).sort((a,b)=>b[1].length-a[1].length).slice(0,2).map(([k])=>k);
    return { labels:labeled.length, edges, hot };
  }

  /* 请求 → 剧本 { phases:[[延迟ms,文案]], reply } */
  function script(req){
    const clip=(s)=>s?`「${s.slice(0,40)}${s.length>40?'…':''}」`:'';
    switch(req.type){
      case 'selection-op':{
        const table={
          dcard:{ reply:'已把选中内容整理为决策卡草稿 D5：三段结构（选了什么 / 为什么 / 否掉了谁），被否候选待你补充。',
            acts:[{icon:'table',kind:'edit',title:'选区 → 决策卡草稿',sub:'D5 · 待定',sec:'dec'}] },
          risk:{ reply:'已提为风险 R6（影响待评级）挂到 §6 风险表，缓解措施待补。',
            acts:[{icon:'warn',kind:'chart',title:'选区 → 风险 R6',sub:'影响待评级 · 待补缓解',sec:'risk'}] },
          open:{ reply:'已提为 Q6 加入 §8 待确认表，owner 默认产品，不卡开工。',
            acts:[{icon:'note',kind:'edit',title:'选区 → 待确认 Q6',sub:'owner：产品',sec:'open'}] },
          explain:{ reply:'这段属于 Strangler 并存策略：新旧两套数据层同时在线，旧路径保证现有前端不回归（G4），新路径给新前端消费；等新前端接上后按 Q3 的退休条款删旧路径。' },
        };
        const t=table[req.op]||table.explain;
        return { phases:[[0,'正在读取 plan 结构…'],[700,'正在沿引用图核对…']],
          reply:{ quote:req.quote&&req.quote.slice(0,40), body:[t.reply], acts:t.acts } };
      }
      case 'analyze-notes':{
        const ns=req.notes;
        const pts=[...new Set(ns.map(n=>n.pt).filter(Boolean))].join(' / ')||'正文';
        return { phases:[[0,'正在归并批注…'],[800,'正在沿依据链交叉分析…']],
          reply:{ body:[
            `已把 ${ns.length} 条批注归并分析：它们分别落在 ${pts} 上。`,
            '共性是都在质疑「AI 结论的可回退性」——周衍(D3)要观测埋点、陈默(R2)要更多 fixture，本质都是「先留证据再砍功能」。建议：D3 迁移期补一条 rewrite 日志埋点（回应周衍），并把 §4.6 的 fixture 从 4 提到 6（回应陈默）。林越(P1)已解决，可关闭。'
          ],
          acts:[
            { icon:'edit',  kind:'edit', title:'生成 2 条待办', sub:'埋点 · 补 fixture', sec:'how' },
            { icon:'check', kind:'edit', title:'建议关闭 1 条已解决', sub:'林越 · P1', pt:'P1' },
          ]}};
      }
      case 'command':{
        if(req.id==='ai-review') return { phases:[[0,'正在通读 8 节…'],[700,'正在核对决策链与验收…']],
          reply:{ body:['评审完成：决策链自洽、验收全部可判定。1 条建议——R2（泛化质量）风险下，§4.6 的 4 个 fixture 全是中文形态，建议补 1 个英文 plan 样本。'],
            acts:[{icon:'warn',kind:'chart',title:'1 条评审建议',sub:'fixture 覆盖面 · §4.6',pt:'S6'}] } };
        const st=refStats();
        return { phases:[[0,'正在扫描标签引用图…']],
          reply:{ body:[`检查完成：${st.labels} 个稳定标签、${st.edges} 条引用边，无悬空引用。${st.hot.join(' 与 ')} 被引用最多，是当前依据网络的枢纽。`],
            acts:[{icon:'link',kind:'canvas',title:'引用图健康',sub:'0 悬空 · 全部可导航',pt:st.hot[0]}] } };
      }
      default: /* chat */
        return { phases:[[0,'正在思考…'],[800,'正在核对依据链…']],
          reply:{ ...(req.quote?{quote:req.quote}:{}) ,
            body:['好的，已按你的要求处理'+(req.quote?`（针对选区 ${clip(req.quote)}）`:'')+'。相关改动都保持了标签引用可溯源，你可以点击对应标签核对依据链。'],
            acts:[{icon:'edit',kind:'edit',title:'已更新 plan',sub:req.quote?'针对选中段落':'相关小节'}] } };
    }
  }

  return {
    send(req, cb){
      const { phases, reply }=script(req);
      const timers=phases.map(([t,label])=>setTimeout(()=>cb.onThinking(label), t));
      const last=phases.length?phases[phases.length-1][0]:0;
      timers.push(setTimeout(()=>{ cb.onThinking(null); cb.onReply(reply); }, last+900));
      return ()=>timers.forEach(clearTimeout);
    },
  };
}

Object.assign(window,{ createMockAgent });

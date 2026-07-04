/* ═══════════════ Spec — Agent 接入（本地 CLI：claude -p / codex exec） ═══════════════ */
const { useState:useStateA } = React;

function AgentConfig({ cfg, onSave, onClose }){
  const [d,setD]=useStateA({ ...cfg });
  const [status,setStatus]=useStateA('ok'); // ok | checking
  const cli=AGENT_CLIS.find(c=>c.id===d.cli);
  const pick=(id)=>{ setD(s=>({...s,cli:id})); setStatus('checking'); setTimeout(()=>setStatus('ok'),700); };
  const recheck=()=>{ setStatus('checking'); setTimeout(()=>setStatus('ok'),700); };

  return (
    <div className="cmdk-back" onMouseDown={onClose}>
      <div className="agent-modal" onMouseDown={e=>e.stopPropagation()}>
        <div className="agent-head">
          <span className="abi">{I.code}</span>
          <div className="at"><b>Agent 接入</b><span>Spec 通过本地 CLI agent 读仓库、生成与修改内容</span></div>
          <button className="x" onClick={onClose}>{I.close}</button>
        </div>

        <div className="agent-body">
          <div className="acfg">
            <div className="clb">{I.bot}CLI Agent</div>
            <div className="opt-list">
              {AGENT_CLIS.map(c=><div key={c.id} className={`opt${d.cli===c.id?' on':''}`} onClick={()=>pick(c.id)}>
                <div className="ot"><b>{c.name}<code>{c.short}</code></b><span>{c.desc}</span></div>
                <div className="radio"></div>
              </div>)}
            </div>
          </div>

          <div className="acfg">
            <div className="clb">{I.book}工作目录</div>
            <div className="chint">agent 只在该目录内读写文件与执行命令。</div>
            <input className="cwd-input" value={d.cwd} spellCheck={false} onChange={e=>setD(s=>({...s,cwd:e.target.value}))}/>
          </div>

          <div className="acfg">
            <div className="clb">{I.code}调用命令</div>
            <div className="chint">对话消息作为 prompt 传给这条命令，输出流式回传到左侧对话。</div>
            <pre className="cli-cmd">{cli.cmd(d.cwd)}</pre>
          </div>

          <div className="acfg">
            <div className="clb">{I.check}连接状态</div>
            <div className="cli-status">
              {status==='checking'
                ? <span className="st checking"><i className="spin"></i>检测 {cli.bin} …</span>
                : <span className="st ok"><i className="dot"></i>{cli.bin} {cli.ver} · 就绪</span>}
              <button className="pc-btn" onClick={recheck}>重新检测</button>
            </div>
          </div>
        </div>

        <div className="agent-foot">
          <span className="sp"></span>
          <button className="cancel" onClick={onClose}>取消</button>
          <button className="save" onClick={()=>{ onSave(d); onClose(); }}>保存</button>
        </div>
      </div>
    </div>
  );
}
window.AgentConfig = AgentConfig;

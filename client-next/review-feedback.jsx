/* ═══ Spec Plan — 面板反馈弹层 ═══
   不打断审阅心流的反馈入口：快捷键（⌘/Ctrl+Shift+F，接线在 review-app.jsx）唤起一个
   轻量弹层，输入一句话（必填）+ 选一个分类，提交即经 buildFeedbackPayload → postFeedback
   上报。现场信息（sessionId / dom / consoleErrors / viewport / activeSection）由 App 在
   提交时自动打包，用户不用管。样式复用改写弹窗（rw-modal）的既有类，不引新依赖。 */
const { useState: useStateFb, useRef: useRefFb, useEffect: useEffectFb } = React;

/* 分类预设：值对应后端 category（自由文本，无强校验）。固定几个够用，不做自定义输入。 */
const FEEDBACK_CATS=[
  { id:'extract-bug',  label:'抽取错误' },
  { id:'verify-noise', label:'校验噪音' },
  { id:'ux',           label:'体验' },
  { id:'workflow',     label:'流程' },
  { id:'idea',         label:'想法' },
];

/* onSubmit(text, category) → Promise：由 App 打包现场信息后 postFeedback。 */
function FeedbackPopover({ onClose, onSubmit }){
  const [text,setText]=useStateFb('');
  const [cat,setCat]=useStateFb('');
  const [busy,setBusy]=useStateFb(false);
  const taRef=useRefFb(null);
  useEffectFb(()=>{ taRef.current&&taRef.current.focus(); },[]);
  const canSend=text.trim().length>0&&!busy;
  async function send(){
    if(!canSend) return;
    setBusy(true);                                   /* 防重复提交（frontend §5）*/
    try{ await onSubmit(text.trim(), cat); }
    finally{ setBusy(false); }
  }
  return (
    <div className="cmdk-back" onMouseDown={onClose}>
      <div className="rw-modal fb-modal" onMouseDown={e=>e.stopPropagation()}>
        <div className="rw-head">
          <span className="ri">{I.note}</span>
          <div className="rt"><b>反馈这块面板</b><span>抽取错了 / 校验噪音 / 体验卡点，随手记一句</span></div>
          <button className="x" onClick={onClose}>{I.close}</button>
        </div>
        <div className="rw-body">
          <textarea ref={taRef} rows="3" placeholder="一句话说清现象或建议…（⌘↵ 提交）" value={text}
            onChange={e=>setText(e.target.value)}
            onKeyDown={e=>{ if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){ e.preventDefault(); send(); } }}/>
          <div className="rw-presets fb-cats">
            {FEEDBACK_CATS.map(c=>(
              <button key={c.id} className={cat===c.id?'on':''}
                onClick={()=>setCat(v=>v===c.id?'':c.id)}>{c.label}</button>
            ))}
          </div>
        </div>
        <div className="rw-foot">
          <span className="hint">⌘↵ 提交 · esc 关闭</span>
          <button className="cancel" onClick={onClose}>取消</button>
          <button className="go" disabled={!canSend} onClick={send}>{I.send}{busy?'提交中…':'提交反馈'}</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window,{ FeedbackPopover, FEEDBACK_CATS });

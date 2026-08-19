/* 面板静态操作定义。文档内容、会话和 AI 回复均来自后端。 */
const SUGG = [
  { icon:'check', text:'评审这份文档的风险与漏洞' },
  { icon:'link', text:'检查有没有悬空引用' },
  { icon:'edit', text:'帮我优化选中的内容' },
];

const SEL_MORE = [
  { id:'dcard', icon:'table', label:'转为决策卡', k:'⌘D' },
  { id:'risk', icon:'warn', label:'提为风险项', k:'⌘R' },
  { id:'open', icon:'note', label:'提为待确认', k:'⌘U' },
  { id:'explain', icon:'info', label:'解释这段', k:'⌘/' },
];

const CMDS = [
  { grp:'AI 操作', items:[
    { id:'ai-review', icon:'check', title:'评审这份文档', sub:'检查决策、风险与验收' },
    { id:'ai-refs', icon:'link', title:'检查悬空引用', sub:'扫描标签引用图' },
  ]},
  { grp:'定位', items:[
    { id:'go-dec', icon:'sparkF', title:'跳到决策', sub:'查看核心决策', sec:'dec' },
    { id:'go-pre', icon:'warn', title:'跳到前置', sub:'查看待拍板前置', sec:'pre' },
    { id:'go-acc', icon:'check', title:'跳到验收', sub:'查看验收条件', sec:'acc' },
  ]},
];

Object.assign(window,{ SUGG, SEL_MORE, CMDS });

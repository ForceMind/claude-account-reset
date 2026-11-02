const modes={
 audit:{command:'reset',label:'只生成账号检查计划，不修改客户端数据。',execute:false},
 reset:{command:'reset',label:'审阅计划后再执行；账号清理先备份并校验。',execute:true},
 traces:{command:'reset',flags:['--traces'],label:'计划额外包含已知账号功能、遥测和退出标记；不是全盘缓存清理。',execute:true},
 'recover-audit':{command:'recover',label:'只生成会话恢复计划，显示选择、保护和副本分类。',execute:false},
 recover:{command:'recover',label:'仅新增缺失索引；手动权限、远程控制关闭，保留正文。',execute:true},
 'handoff-audit':{command:'handoff',label:'只生成正文转换计划，核对thinking数量、范围和空间需求。',execute:false},
 handoff:{command:'handoff',label:'执行会改写选定正文。先检查备份与暂存结果，再安装并校验。',execute:true}
};
let mode='audit';
const node=s=>document.querySelector(s);
const uuid=/^(?:local_)?[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function render(){
 const spec=modes[mode],sessionMode=spec.command!=='reset';let error='';
 node('#keychain').disabled=!['reset','traces'].includes(mode);if(node('#keychain').disabled)node('#keychain').checked=false;
 node('#selection-controls').hidden=!sessionMode;
 const flags=[...(spec.flags??[])];
 if(node('#keychain').checked)flags.push('--include-keychain');
 if(node('#discard').checked)flags.push('--discard-backup');
 if(sessionMode){
  const ids=node('#session-ids').value.trim().split(/[\s,]+/).filter(Boolean);
  if(ids.some(id=>!uuid.test(id)))error='会话 ID 格式不正确，请从本地预览结果复制 UUID。';
  else for(const id of ids)flags.push('--session',id);
  const date=node('#protect-date').value,zone=node('#time-zone').value;
  if(date){if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!['Asia/Shanghai','UTC'].includes(zone))error='请指定有效保护日期和时区。';else flags.push('--protect-since',date,'--time-zone',zone);}
 }
 const plan=`node bin/${spec.command}.mjs${flags.length?' '+flags.join(' '):''} --plan-out ${spec.command}.plan.json`;
 const execute=`node bin/${spec.command}.mjs --execute ${spec.command}.plan.json --yes`;
 node('#mode-command').textContent=error||plan;node('#copy-mode').dataset.copy=error?'':plan;node('#copy-mode').disabled=!!error;
 node('#execute-step').hidden=!spec.execute;
 node('#execute-command').textContent=execute;node('#copy-execute').dataset.copy=error?'':execute;node('#copy-execute').disabled=!!error;
 node('#mode-description').textContent=error||spec.label;
 document.querySelectorAll('[data-mode]').forEach(b=>{const active=b.dataset.mode===mode;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
}
document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>{mode=b.dataset.mode;render();}));
for(const id of ['#keychain','#discard','#session-ids','#protect-date','#time-zone'])node(id).addEventListener('input',render);
let timer;
document.querySelectorAll('[data-copy]').forEach(b=>b.addEventListener('click',async()=>{
 if(!b.dataset.copy)return;const status=node('#status');
 try{await navigator.clipboard.writeText(b.dataset.copy);status.textContent='命令已复制';}catch{status.textContent='无法自动复制，请手动选择命令';}
 clearTimeout(timer);timer=setTimeout(()=>{status.textContent='';},3000);
}));
render();

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
test('website separates preview/apply, freezes flags in plan, and rejects command injection',async()=>{
 const el=()=>({dataset:{},disabled:false,hidden:false,checked:false,value:'',textContent:'',events:{},addEventListener(n,fn){this.events[n]=fn;},classList:{toggle(){}},setAttribute(){}});
 const ids=['#keychain','#discard','#selection-controls','#session-ids','#protect-date','#time-zone','#mode-command','#copy-mode','#execute-step','#execute-command','#copy-execute','#mode-description','#status'];const nodes=Object.fromEntries(ids.map(n=>[n,el()]));nodes['#time-zone'].value='Asia/Shanghai';
 const modes=['audit','reset','traces','recover-audit','recover','handoff-audit','handoff'].map(mode=>({...el(),dataset:{mode}}));
 const document={querySelector:s=>nodes[s],querySelectorAll:s=>s==='[data-mode]'?modes:[]};vm.runInNewContext(await fs.readFile(new URL('../site/app.js',import.meta.url),'utf8'),{document,setTimeout,clearTimeout});
 assert.equal(nodes['#execute-step'].hidden,true);assert.ok(!nodes['#mode-command'].textContent.includes('--yes'));
 modes[1].events.click();nodes['#keychain'].checked=true;nodes['#keychain'].events.input();assert.match(nodes['#mode-command'].textContent,/--include-keychain/);assert.ok(!nodes['#execute-command'].textContent.includes('keychain'));
 modes[4].events.click();assert.equal(nodes['#keychain'].checked,false);assert.equal(nodes['#keychain'].disabled,true);assert.equal(nodes['#mode-command'].textContent,'node bin/recover.mjs --plan-out recover.plan.json');
 nodes['#protect-date'].value='2026-11-02';nodes['#protect-date'].events.input();assert.match(nodes['#mode-command'].textContent,/--protect-since 2026-11-02 --time-zone Asia\/Shanghai/);
 assert.equal(nodes['#execute-command'].textContent,'node bin/recover.mjs --execute recover.plan.json --yes');
 modes[6].events.click();nodes['#discard'].checked=true;nodes['#discard'].events.input();assert.match(nodes['#mode-command'].textContent,/--discard-backup/);assert.ok(!nodes['#execute-command'].textContent.includes('--discard-backup'));
 nodes['#session-ids'].value='$(unsafe)';nodes['#session-ids'].events.input();assert.equal(nodes['#copy-mode'].disabled,true);assert.equal(nodes['#copy-execute'].disabled,true);assert.equal(nodes['#copy-mode'].dataset.copy,'');
 nodes['#session-ids'].value='local_11111111-1111-4111-8111-111111111111';nodes['#session-ids'].events.input();assert.equal(nodes['#copy-mode'].disabled,false);assert.match(nodes['#mode-command'].textContent,/--session local_/);
});

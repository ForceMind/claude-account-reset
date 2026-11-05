import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {parseCLI} from '../lib/cli.mjs';

test('download package is a complete Skill with working reference and command graph',async()=>{
 const root=new URL('..',import.meta.url).pathname;
 execFileSync(process.execPath,['scripts/build-site.mjs'],{cwd:root});
 const pkg=JSON.parse(await fs.readFile(new URL('../package.json',import.meta.url)));
 const archive=`site/downloads/claude-account-reset-${pkg.version}.tar.gz`;
 const names=execFileSync('tar',['-tzf',archive],{cwd:root,encoding:'utf8'}).trim().split('\n');
 for(const name of ['SKILL.md','agents/openai.yaml','package.json','package-lock.json','bin/reset.mjs','bin/recover.mjs','bin/handoff.mjs','bin/backup.mjs','lib/cli.mjs','lib/engine.mjs','lib/planner.mjs'])assert.ok(names.includes(name),name);
 for(const name of ['desktop/main.mjs','desktop/library.mjs','desktop/environment.mjs','desktop/readonly.mjs','desktop/ui/renderer.ts','docs/DESKTOP.md','forge.config.cjs'])assert.ok(names.includes(name),name);
 assert.equal(names.some(n=>/\.(jsonl|sqlite|dmg|zip)$|\.(report|plan)\.json$|(^|\/)(payload|operation-backups|work)\//.test(n)),false,'Private/generated files entered the source archive');
 const skill=execFileSync('tar',['-xOf',archive,'SKILL.md'],{cwd:root,encoding:'utf8'});
 assert.match(skill,/^---\nname: claude-account-reset\ndescription: .+\n---\n/);
 for(const link of skill.matchAll(/\]\(([^)]+)\)/g))assert.ok(names.includes(link[1]),`Missing packaged reference: ${link[1]}`);
 for(const name of names.filter(n=>n.endsWith('.mjs'))){const source=execFileSync('tar',['-xOf',archive,name],{cwd:root,encoding:'utf8'});for(const match of source.matchAll(/from ['"]([.][^'"]+)['"]/g)){const resolved=new URL(match[1],new URL(name,'file:///')).pathname.slice(1);assert.ok(names.includes(resolved),`Missing module: ${resolved}`);}}
 assert.deepEqual(parseCLI('reset',['--plan-out','account-review.plan.json']).options,{});
 assert.throws(()=>parseCLI('reset',['--apply','--yes']),/saved plan/);
 assert.throws(()=>parseCLI('reset',['--execute','account-review.plan.json']),/--yes/);
 const ui=execFileSync('tar',['-xOf',archive,'agents/openai.yaml'],{cwd:root,encoding:'utf8'});assert.ok(ui.includes('$claude-account-reset'));
});

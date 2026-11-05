import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('public release metadata, README and site agree on preview downloads without local paths or bundled large assets',async()=>{
 const root=new URL('../',import.meta.url),pkg=JSON.parse(await fs.readFile(new URL('package.json',root))),release=JSON.parse(await fs.readFile(new URL(`release/v${pkg.version}.json`,root)));
 assert.equal(release.version,pkg.version);assert.equal(release.architecture,'arm64');assert.equal(release.channel,'preview');assert.equal(release.signature.developerId,false);
 assert.equal(release.artifacts.length,2);
 const html=await fs.readFile(new URL('site/index.html',root),'utf8'),readme=await fs.readFile(new URL('README.md',root),'utf8');
 for(const a of release.artifacts){assert.match(a.sha256,/^[a-f0-9]{64}$/);assert(a.bytes>25*1024*1024);assert(html.includes('downloads/'+a.name));assert(readme.includes('/releases/download/'+release.tag+'/'+a.name));}
 assert(html.includes('SHA256SUMS'));assert(html.includes('v'+pkg.version));assert(html.includes('ad-hoc'));assert(!html.includes('/Users/'));assert(!JSON.stringify(release).includes('/Users/'));
 assert(!html.includes('0.4.1'));assert(html.indexOf('下载 macOS 应用')<html.indexOf('node bin/'));
 for(const a of release.artifacts)await assert.rejects(fs.stat(new URL('site/downloads/'+a.name,root)),/ENOENT/);
});

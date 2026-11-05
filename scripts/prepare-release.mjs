import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
const {version}=JSON.parse(await fs.readFile('package.json'));
const release=JSON.parse(await fs.readFile(`site/downloads/release-v${version}.json`));
const destination=path.resolve(`out/release/v${version}`);await fs.mkdir(destination,{recursive:true});
async function digest(file){const h=createHash('sha256');for await(const b of createReadStream(file))h.update(b);return h.digest('hex');}
for(const artifact of release.artifacts){
  const source=artifact.name.endsWith('.dmg')?`out/make/${artifact.name}`:artifact.name.endsWith('.zip')?`out/make/zip/darwin/arm64/Claude Account Reset-darwin-arm64-${version}.zip`:`site/downloads/${artifact.name}`;
  if((await fs.stat(source)).size!==artifact.bytes||await digest(source)!==artifact.sha256)throw Error('Release asset differs from the public manifest: '+artifact.name);
  await fs.copyFile(source,path.join(destination,artifact.name));
  if(await digest(path.join(destination,artifact.name))!==artifact.sha256)throw Error('Staged asset differs from manifest');
}
for(const name of ['SHA256SUMS',`release-v${version}.json`])await fs.copyFile('site/downloads/'+name,path.join(destination,name));
console.log(`Staged ${release.artifacts.length} verified assets, checksums and public metadata in out/release/v${version}`);

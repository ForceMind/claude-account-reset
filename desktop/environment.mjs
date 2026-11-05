import path from 'node:path';
import {exists} from '../lib/safety.mjs';
import {jsonFile,shortText} from './readonly.mjs';

function endpoint(value){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)?`${u.protocol}//${u.hostname}${u.port?':'+u.port:''}`:'地址格式无法识别';}catch{return '地址格式无法识别';}}
function model(value){return typeof value==='string'&&/^[a-zA-Z0-9_./:-]{1,120}$/.test(value)&&!/^sk-|^eyJ/.test(value)?value:'未识别';}
function mask(value){if(typeof value!=='string'||!value)return null;const at=value.indexOf('@');return at>0?value[0]+'***'+value.slice(at):value.length>8?value.slice(0,4)+'…'+value.slice(-4):'已记录';}
export async function environmentOverview(directories,{home,check=()=>{}}={}){
  const cards=[],issues=[],projects=directories.filter(d=>d.kind==='project');
  const contexts=directories.filter(d=>d.kind!=='project').flatMap(directory=>directory.kind==='code'&&projects.length?projects.map(project=>({directory,project})):[{directory,project:null}]);
  for(const context of contexts){
    const d=context.directory,projectScope=context.project?[context.project]:[];
    check();const card={name:d.name,path:d.path,kind:d.kind,sources:[],candidates:[],conflicts:[],mcp:[],credentials:[],identity:[],version:'未检查安装版本',connection:'未在已检查配置中指定',model:'未在已检查配置中指定',runtime:'未验证实际运行状态'};
    if(context.project){card.name+=' · '+path.basename(context.project.path);card.projectPath=context.project.path;}
    const settings=d.kind==='code'?[{file:path.join(d.path,'settings.json'),scope:'用户配置'}]:[{file:path.join(d.path,'config.json'),scope:'Desktop 本地缓存'},{file:path.join(d.path,'claude_desktop_config.json'),scope:'Desktop 配置'}];
    if(d.kind==='code')for(const p of projectScope)settings.push({file:path.join(p.path,'.claude/settings.json'),scope:'项目共享配置'},{file:path.join(p.path,'.claude/settings.local.json'),scope:'项目本地配置'},{file:path.join(p.path,'.mcp.json'),scope:'项目 MCP 配置',mcpOnly:true});
    if(d.kind==='code'){
      settings.push({file:path.join(d.path,'.claude.json'),scope:'Code 本地账号缓存',identityOnly:true});
      if(d.path===path.join(home,'.claude'))settings.push({file:path.join(home,'.claude.json'),scope:'Code 默认账号缓存',identityOnly:true});
      card.credentials.push({name:'本地凭据文件',configured:await exists(path.join(d.path,'.credentials.json'))});
    }
    const mcp=new Set();
    for(const source of settings){
      check();if(!await exists(source.file)){card.sources.push({...source,state:'未发现'});continue;}
      try{
        const {data}=await jsonFile(source.file);card.sources.push({...source,state:'已读取白名单字段'});
        const collectMcp=servers=>{if(servers&&typeof servers==='object'&&!Array.isArray(servers))for(const key of Object.keys(servers))mcp.add(shortText(key,100));};
        collectMcp(data.mcpServers);
        if(source.identityOnly)for(const p of projectScope)collectMcp(data.projects?.[p.path]?.mcpServers);
        const identity=data.oauthAccount??{};
        for(const [name,value]of [['账号',identity.emailAddress??identity.email??data.lastKnownAccountUuid],['组织',identity.organizationUuid??identity.organizationUUID]]){const masked=mask(value);if(masked)card.identity.push({name,value:masked,source:source.file,status:'本地缓存线索，非在线登录状态'});}
        if(source.identityOnly||source.mcpOnly)continue;
        if(typeof data.updaterLastSeenVersion==='string')card.version=shortText(data.updaterLastSeenVersion,50)+'（缓存线索）';
        const env=data.env&&typeof data.env==='object'&&!Array.isArray(data.env)?data.env:{};
        const candidates=[];
        if(typeof data.model==='string')candidates.push({field:'model',value:model(data.model)});
        if(typeof env.ANTHROPIC_MODEL==='string')candidates.push({field:'model',value:model(env.ANTHROPIC_MODEL)});
        if(typeof env.ANTHROPIC_BASE_URL==='string')candidates.push({field:'connection',value:endpoint(env.ANTHROPIC_BASE_URL)});
        for(const key of ['CLAUDE_CODE_USE_BEDROCK','CLAUDE_CODE_USE_VERTEX','CLAUDE_CODE_USE_FOUNDRY'])if(env[key]==='1'||env[key]===true)candidates.push({field:'connection',value:key});
        if(typeof data.deploymentMode==='string')candidates.push({field:'connection',value:data.deploymentMode==='1p'?'官方 Desktop 模式':data.deploymentMode==='3p'?'Desktop 第三方模式':'未识别的 Desktop 模式'});
        for(const c of candidates)card.candidates.push({...c,source:source.file,scope:source.scope});
        for(const key of ['ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CLAUDE_CODE_OAUTH_TOKEN'])if(Object.hasOwn(env,key))card.credentials.push({name:key,configured:!!env[key],source:source.file});
        if(Object.hasOwn(data,'apiKeyHelper'))card.credentials.push({name:'外部凭据提供器',configured:!!data.apiKeyHelper,source:source.file});
      }catch{card.sources.push({...source,state:'读取失败，未推断为空'});issues.push({path:source.file,message:'配置损坏、权限不足或正在变化，未输出内容'});}
    }
    for(const field of ['model','connection']){
      const candidates=card.candidates.filter(c=>c.field===field);if(candidates.length)card[field]=candidates.at(-1).value+'（已检查范围内的候选）';
      if(new Set(candidates.map(c=>c.value)).size>1)card.conflicts.push(field==='model'?'多处模型配置不同，请核对来源；不能据此断言正在使用哪个模型。':'多处连接配置不同，请核对来源；不能据此断言当前实际请求路径。');
    }
    card.mcp=[...mcp];cards.push(card);
  }
  return {cards,issues,limits:['托管策略、运行中的其他进程环境及在线登录状态未检查。','只展示已授权配置中的候选值，不能代表完整生效配置。','连接地址仅显示协议、主机和端口；凭据值、URL 用户信息及查询参数不显示。','MCP 和凭据提供器不会执行；不发送模型请求或网络探测。',projects.length?(cards.some(c=>c.kind==='code')?'项目文件仅来自手动选择的项目目录。':'未选择 Code 资料，项目级设置未读取。'):'尚未授权项目目录，项目级配置未检查。','不读取 CC Switch 私有数据库；只检查它可能写入的 Claude 配置，无法仅凭文件认定写入来源。']};
}

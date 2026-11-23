import {spawnSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
export function summarizeAudit(input){
 if(!input||typeof input!=='object'||input.error||!input.metadata?.vulnerabilities||!input.vulnerabilities||typeof input.vulnerabilities!=='object'||Array.isArray(input.vulnerabilities))throw Error('DEPENDENCY_AUDIT_INVALID');
 const findings=Object.entries(input.vulnerabilities).map(([name,v])=>{
  if(!/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i.test(name)||!v||!['info','low','moderate','high','critical'].includes(v.severity)||typeof v.range!=='string'||!Array.isArray(v.via)||!Array.isArray(v.nodes))throw Error('DEPENDENCY_AUDIT_INVALID');
  return {name,severity:v.severity,direct:v.isDirect===true,range:v.range,fixAvailable:Boolean(v.fixAvailable),advisories:v.via.filter(x=>x&&typeof x==='object').map(x=>({id:x.source,severity:x.severity,title:typeof x.title==='string'?x.title.slice(0,300):'',url:typeof x.url==='string'&&/^https:\/\/(?:github\.com\/advisories\/|www\.npmjs\.com\/advisories\/)/.test(x.url)?x.url:null})),paths:v.nodes.filter(x=>typeof x==='string'&&/^node_modules\/[a-zA-Z0-9@_./-]+$/.test(x)).slice(0,50)};
 });
 return {version:1,product:'averidi-dashboard',checkedAt:new Date().toISOString(),status:findings.some(f=>['high','critical'].includes(f.severity))?'BLOCKED':'PASSED',blockingSeverities:['high','critical'],findings};
}
export async function runDependencyAudit(destination='.local/security/dependency-audit.json'){
 const result=spawnSync(process.platform==='win32'?'npm.cmd':'npm',['audit','--json','--ignore-scripts'],{encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024});
 let report;
 try{if(result.error||result.signal||result.status===null||result.status>1)throw Error('DEPENDENCY_AUDIT_UNAVAILABLE');report=summarizeAudit(JSON.parse(result.stdout));}
 catch{report={version:1,product:'averidi-dashboard',checkedAt:new Date().toISOString(),status:'ERROR',reason:'DEPENDENCY_AUDIT_UNAVAILABLE'};}
 await mkdir(path.dirname(destination),{recursive:true});await writeFile(destination,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({status:report.status,findings:'findings' in report?report.findings.length:null,report:destination}));return report.status==='PASSED'?0:1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))void runDependencyAudit(process.argv[2]).then(code=>{process.exitCode=code;}).catch(()=>{console.error('DEPENDENCY_AUDIT_UNAVAILABLE');process.exitCode=1;});

import {readFile,writeFile,mkdir,mkdtemp,lstat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import path from 'node:path';
const root=process.cwd();
const git=(args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});
try{
 if(git(['branch','--show-current']).trim()!=='feature/independent-dashboard')throw Error('Wrong branch.');
 if(git(['diff','--name-only','--diff-filter=U']).trim())throw Error('Resolve pending conflicts first.');
 const sessionPath='src/server/browser-session.ts',boundaryPath='src/server/auth-boundary.ts',studioPath='src/app/workspaces/[workspaceId]/studio/page.tsx';
 const session=await readFile(path.join(root,sessionPath),'utf8'),boundary=await readFile(path.join(root,boundaryPath),'utf8'),studio=await readFile(path.join(root,studioPath),'utf8');
 if(session.includes('dashboard_session_verification_failed')||boundary.includes('dashboard_request_unauthenticated'))throw Error('Diagnostics already installed. Retry upload and inspect terminal output.');
 const target='} catch {return null;}';
 if(session.split(target).length!==2)throw Error('Session source differs; no files changed.');
 const signature='export async function getAuthenticatedDashboardActor(';
 if(boundary.split(signature).length!==2)throw Error('Authentication source differs; no files changed.');
 const uploadTarget='if(!created.ok)throw new Error("Dataset could not be created. Check subscription and edit permissions.");';
 if(!studio.includes(uploadTarget))throw Error('Upload source differs; no files changed.');
 const files={};
 files[sessionPath]=session.replace(target,"} catch(error) {\n    const value=error as {code?:unknown;errorCode?:unknown;name?:unknown};\n    const candidate=value.code??value.errorCode;\n    console.error(JSON.stringify({event:'dashboard_session_verification_failed',code:typeof candidate==='string'&&/^[A-Z0-9_]{1,80}$/.test(candidate)?candidate:'UNCLASSIFIED',type:typeof value.name==='string'&&/^[A-Za-z]{1,80}$/.test(value.name)?value.name:'Error'}));\n    return null;\n  }");
 files[boundaryPath]=boundary.replace(signature,'async function getAuthenticatedDashboardActorImpl(')+
 '\nexport async function getAuthenticatedDashboardActor(request:Request):Promise<VerifiedDashboardActor|null>{\n const actor=await getAuthenticatedDashboardActorImpl(request);\n if(!actor)console.error(JSON.stringify({event:"dashboard_request_unauthenticated",method:request.method,cookiePresent:(request.headers.get("cookie")??"").split(";").some(p=>p.trim().startsWith("__Secure-averidi-dashboard="))}));\n return actor;\n}\n';
 files[studioPath]=studio.replace(uploadTarget,'if(!created.ok){const failure:{error?:string}=await created.json().catch(()=>({}));const code=failure.error??"UNKNOWN";throw new Error(created.status===401?"Your session could not be verified. Sign in again and retry. (401 "+code+")":created.status===402?"Trial or subscription access is unavailable. ("+code+")":"Dataset creation failed ("+created.status+" "+code+").");}');
 const ts=createRequire(path.join(root,'package.json'))('typescript');
 for(const [p,c] of Object.entries(files)){
  const info=await lstat(path.join(root,p));if(!info.isFile()||info.isSymbolicLink())throw Error('Unsafe target.');
  const r=ts.transpileModule(c,{fileName:p,reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}});
  if(r.diagnostics?.some(d=>d.category===ts.DiagnosticCategory.Error))throw Error('Syntax validation failed; no files changed.');
 }
 const local=path.join(root,'.local');await mkdir(local,{recursive:true,mode:0o700});
 const info=await lstat(local);if(!info.isDirectory()||info.isSymbolicLink())throw Error('Unsafe backup directory.');
 const backup=await mkdtemp(path.join(local,'upload-session-'));
 for(const p of Object.keys(files))await writeFile(path.join(backup,p.replaceAll('/','__')),await readFile(path.join(root,p)),{mode:0o600});
 for(const [p,c] of Object.entries(files))await writeFile(path.join(root,p),c);
 console.log('Upload/session diagnostics installed. Authentication rules and local cleanup were preserved.');
 console.log('Backups: '+path.relative(root,backup));
}catch(error){console.error(error.message);process.exitCode=1;}

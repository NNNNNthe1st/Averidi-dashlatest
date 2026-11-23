import {readFile,writeFile,mkdir,mkdtemp,lstat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import path from 'node:path';
const root=process.cwd(),edits={"src/app/api/workspaces/[workspaceId]/datasets/[datasetId]/versions/route.ts":[["if(error instanceof DashboardIngestValidationError)return respond(\"INVALID_DATASET\",422);","if(error instanceof DashboardIngestValidationError)return NextResponse.json({error:\"INVALID_DATASET\",message:error.message.slice(0,2000)},{status:422,headers});"]],"src/app/api/workspaces/[workspaceId]/datasets/preview/route.ts":[["if(error instanceof DashboardIngestValidationError)return respond(\"INVALID_DATASET\",422);","if(error instanceof DashboardIngestValidationError)return NextResponse.json({error:\"INVALID_DATASET\",message:error.message.slice(0,2000)},{status:422,headers});"]],"src/app/workspaces/[workspaceId]/studio/page.tsx":[["if(!uploaded.ok){\n        const data:{error?:string}=await uploaded.json().catch(()=>({}));","if(!uploaded.ok){\n        if(!uploadDatasetId)setUploadDatasetId(datasetId);\n        const data:{error?:string;message?:string}=await uploaded.json().catch(()=>({}));"],["Upload failed (${data.error??uploaded.status}).","Upload failed: ${data.message??data.error??uploaded.status}."],["The dataset was created; select it to retry.","The dataset is selected and ready for another attempt."],["const body:{error?:string}=await response.json().catch(()=>({}));throw new Error(`Preview failed (${body.error??response.status})`);","const body:{error?:string;message?:string}=await response.json().catch(()=>({}));throw new Error(body.message??`Preview failed (${body.error??response.status})`);"]]};
try{
 const branch=execFileSync('git',['branch','--show-current'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 if(branch!=='feature/independent-dashboard')throw Error('Wrong branch.');
 const ts=createRequire(path.join(root,'package.json'))('typescript'),files={};
 for(const [p,pairs] of Object.entries(edits)){
  const filename=path.join(root,p),info=await lstat(filename);if(!info.isFile()||info.isSymbolicLink())throw Error('Unsafe target.');
  const original=await readFile(filename,'utf8');let content=original;
  for(const [from,to] of pairs){if(content.split(from).length!==2)throw Error('Source differs or update already installed: '+p+'. No files changed.');content=content.replace(from,to);}
  const result=ts.transpileModule(content,{fileName:p,reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}});
  if(result.diagnostics?.some(d=>d.category===ts.DiagnosticCategory.Error))throw Error('Syntax check failed; no files changed.');
  files[p]={original,content};
 }
 const local=path.join(root,'.local');await mkdir(local,{recursive:true,mode:0o700});
 const info=await lstat(local);if(!info.isDirectory()||info.isSymbolicLink())throw Error('Unsafe backup directory.');
 const backup=await mkdtemp(path.join(local,'upload-validation-'));
 for(const [p,f] of Object.entries(files))await writeFile(path.join(backup,p.replaceAll('/','__')),f.original,{mode:0o600});
 for(const [p,f] of Object.entries(files))await writeFile(path.join(root,p),f.content);
 console.log('Specific upload/preview validation errors enabled. Failed uploads retain the selected dataset for retry.');
 console.log('Backups: '+path.relative(root,backup));
}catch(error){console.error(error.message);process.exitCode=1;}

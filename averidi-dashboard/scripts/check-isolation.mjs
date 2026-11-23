#!/usr/bin/env node
import {existsSync,readFileSync,readdirSync,lstatSync,realpathSync} from "node:fs";
import {resolve,join,relative,sep,dirname} from "node:path";
import {fileURLToPath} from "node:url";

import {sourceImports} from './verification/source-imports.mjs';

const root=resolve(fileURLToPath(new URL("../",import.meta.url)));
const allowedRoots=["src","scripts","tests","prisma"];
const violations=[];
let scanned=0;
const add=(file,reason,detail)=>violations.push({file:relative(root,file),reason,...(detail?{detail}:{})});
function within(p,base){return p===base||p.startsWith(base+sep);}
function walk(dir){
 if(!existsSync(dir))return;
 for(const entry of readdirSync(dir,{withFileTypes:true})){
  const file=join(dir,entry.name);
  if(entry.isSymbolicLink()){add(file,"Symlink inside isolated project");continue;}
  if(entry.isDirectory()){if(!["node_modules",".next",".git"].includes(entry.name))walk(file);continue;}
  if(!entry.isFile()||!/\.(?:[cm]?[jt]sx?|json)$/.test(entry.name))continue;
  scanned++;
  const source=readFileSync(file,"utf8");
  if(!/\.[cm]?[jt]sx?$/.test(entry.name))continue;
  const imports=sourceImports(source,file);
  for(const spec of imports){
   if(/(^|\/)analyst(\/|$)/i.test(spec)||/^(?:@website\/|@analyst\/|website\/|analyst\/)/i.test(spec))add(file,"Foreign product import",spec);
   if(spec.startsWith(".")){
    const target=resolve(dirname(file),spec);
    if(!within(target,root))add(file,"Import escapes Dashboard project",spec);
   }
   if(spec.startsWith("/")||spec.startsWith("file:"))add(file,"Absolute source dependency",spec);
  }
 }
}
for(const folder of allowedRoots)walk(join(root,folder));
for(const required of ["package.json","prisma/schema.prisma","src/server/db.ts","src/server/storage.ts","next.config.ts"]){
 if(!existsSync(join(root,required)))add(join(root,required),"Required standalone file missing");
}
const pkg=JSON.parse(readFileSync(join(root,"package.json"),"utf8"));
for(const [group,deps] of Object.entries({dependencies:pkg.dependencies??{},devDependencies:pkg.devDependencies??{}})){
 for(const [name,version] of Object.entries(deps)){
  if(/^(?:file:|link:|workspace:)|^\.\.\//.test(String(version)))add(join(root,"package.json"),"Local or shared package dependency",group+":"+name);
  if(/(?:averidi-analyst|sales-solutions)/i.test(name))add(join(root,"package.json"),"Cross-product package",name);
 }
}
if(scanned===0)add(root,"No standalone project source found");
const result={scope:"Dashboard code, scripts, tests, migrations, and dependency declarations",scanned,violations,passed:violations.length===0,note:"A passing source-boundary check does not establish a dedicated repository, deployment, secrets or runtime isolation."};
console.log(JSON.stringify(result,null,2));
if(!result.passed)process.exitCode=1;

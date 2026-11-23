import {readFile,writeFile,mkdir} from 'node:fs/promises';
import * as manifestModule from '../src/contracts/manifest.ts';
const {dashboardContractArtifacts}=manifestModule.default??manifestModule;
const write=process.argv[2]==='--write';
if(process.argv.slice(2).some(v=>!['--write','--check'].includes(v)))throw Error('Use --write or --check');
const artifacts=dashboardContractArtifacts();
if(write)await mkdir('contracts/v1',{recursive:true});
for(const name of ['openapi','schemas']){
 const path=`contracts/v1/${name}.json`,expected=JSON.stringify(artifacts[name],null,2)+'\n';
 if(write)await writeFile(path,expected);
 else if(await readFile(path,'utf8')!==expected)throw Error('Contract artifact drift: '+path);
}
console.log(write?'Dashboard v1 contract artifacts generated.':'Dashboard v1 contract artifacts match runtime schemas.');

#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const manifest=JSON.parse(readFileSync(new URL('../docs/repository-extraction.json',import.meta.url),'utf8'));
let historyRoot=root;
let temporary=null;
function at(cwd,...args){return execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
function git(...args){return at(historyRoot,...args);}
try{
 const gitRoot=at(root,'rev-parse','--show-toplevel');
 if(gitRoot!==root.replace(/\/$/,''))throw Error('Dashboard does not own its Git root.');
 let localBaseline=false;
 try{localBaseline=git('rev-parse','--verify',manifest.baselineTag)===manifest.extractedCommit;}catch{}
 if(!localBaseline||process.argv.includes('--archive')){
  const bundle=join(root,'docs/history/averidi-dashboard.bundle');
  const bytes=readFileSync(bundle);
  if(createHash('sha256').update(bytes).digest('hex')!==manifest.historyBundleSha256)throw Error('Preserved history bundle checksum differs.');
  at(root,'bundle','verify',bundle);
  temporary=mkdtempSync(join(tmpdir(),'dashboard-history-'));
  historyRoot=join(temporary,'history.git');
  execFileSync('git',['clone','--bare','--quiet',bundle,historyRoot],{stdio:['ignore','pipe','pipe']});
 }
 if(git('rev-parse',manifest.baselineTag)!==manifest.extractedCommit)throw Error('Extraction tag differs from the recorded commit.');
 const actualFiles=git('ls-tree','-r','--full-tree',manifest.baselineTag).split('\n');
 const expectedFiles=manifest.files.map(f=>`${f.mode} blob ${f.sha}\t${f.path}`);
 if(actualFiles.length!==expectedFiles.length||actualFiles.some((line,i)=>line!==expectedFiles[i]))throw Error('Extracted baseline file contents, paths or modes differ from the source.');
 const expected=manifest.history.map(x=>x.extractedCommit);
 const actual=git('rev-list','--reverse',manifest.baselineTag).split('\n');
 if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error('Extracted commit history differs from the recorded source history.');
 const trees=git('log','--reverse','--format=%T',manifest.baselineTag).split('\n');
 if(trees.some((tree,i)=>tree!==manifest.history[i].tree))throw Error('A historical Dashboard tree differs from its source subtree.');
 const tree=git('rev-parse',`${manifest.baselineTag}^{tree}`);
 if(tree!==manifest.sourceSubtree)throw Error('Extracted root tree does not match the source subtree.');
 console.log(JSON.stringify({passed:true,historyCommits:actual.length,baselineFiles:actualFiles.length,sourceCommit:manifest.sourceCommit,sourceSubtree:tree,independentGitRoot:true,historySource:temporary?'verified-bundle':'local-refs'},null,2));
}catch(error){console.error(JSON.stringify({passed:false,error:error.message}));process.exitCode=1;}
finally{if(temporary)rmSync(temporary,{recursive:true,force:true});}

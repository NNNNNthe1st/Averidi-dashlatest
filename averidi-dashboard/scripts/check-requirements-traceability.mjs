import {readFile,writeFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const data=JSON.parse(await readFile(path.join(root,'docs/roadmap/requirements-375.json'),'utf8'));
const labels={SOURCE_SUPPORTED:'☑ Source supported',PARTIAL:'☐ Partial',LIVE_PENDING:'☐ Live acceptance pending',DEFERRED:'☐ Deferred / conditional',NOT_IMPLEMENTED:'☐ Not implemented',OUTCOME_UNVERIFIED:'☐ Business outcome unverified'};
const counts=Object.fromEntries(Object.keys(labels).map(k=>[k,0]));
if(data.version!==1||data.requirements.length!==375)throw Error('TRACEABILITY_INCOMPLETE');
const originalHash=createHash('sha256');
for(const [index,r] of data.requirements.entries()){
 if(r.number!==index+1||!Number.isInteger(r.phase)||r.phase<1||r.phase>17||!Object.hasOwn(labels,r.status)||![r.area,r.requirement,r.acceptance,r.assessment,r.verification].every(s=>typeof s==='string'&&s.trim())||!Array.isArray(r.source)||!Array.isArray(r.tests))throw Error('TRACEABILITY_ROW_INVALID');
 originalHash.update(`${r.number}\t${r.requirement}\t${r.acceptance}\n`);
 if(r.status==='SOURCE_SUPPORTED'&&(!r.source.length||!r.tests.length))throw Error('TRACEABILITY_EVIDENCE_MISSING');
 for(const f of [...r.source,...r.tests]){
  if(typeof f!=='string'||f.includes('\\')||path.posix.normalize(f)!==f||f.startsWith('/')||f.startsWith('../'))throw Error('TRACEABILITY_PATH_INVALID');
  const stat=await lstat(path.join(root,f));if(!stat.isFile()||stat.isSymbolicLink())throw Error('TRACEABILITY_PATH_MISSING');
 }
 counts[r.status]++;
}
// This hash pins all 375 original numbers, titles and acceptance descriptions.
const original=originalHash.digest('hex');
if(original!=='398e39929ebeee3d492ceedd577177d7e1b5d469577206002fd3890339e06c8d')throw Error('TRACEABILITY_ORIGINAL_TEXT_CHANGED');
const escape=s=>s.replaceAll('|','\\|').replaceAll('\n',' ');
const links=files=>files.length?files.map(f=>`[${f}](../../${f})`).join('<br>'):'—';
const lines=[
 '# Original 375 requirements — implementation traceability',
 '',
 'Reviewed 2026-10-25 against the independent Dashboard development branch. **These are original roadmap numbers, not the 230 comparison audit references.** Audit 230 is the task of producing this mapping; completing that mapping does not complete the underlying product requirements.',
 '',
 'The original titles and acceptance descriptions are preserved exactly from the original-requirements workbook. The later Word architecture governs independence, the canonical /dashboard/app route, inactive inter-product integration and separately authorized deployment. Original shared-database and app.averidi.com assumptions are superseded where noted.',
 '',
 '**☑ Source supported means the scoped implementation was located and related local suite evidence exists. It does not mean individual 375-point acceptance, live-provider acceptance or production launch approval.** An unchecked row explicitly records a gap, deferred decision or unverified business outcome. Existing 302-test/22-stage baseline evidence is historical evidence for the preceding runtime source. New monitoring acceptance is recorded separately in the progress document.',
 '',
 '| Status | Requirements |', '|---|---:|',
 ...Object.keys(labels).map(k=>`| ${labels[k]} | ${counts[k]} |`),
 '| Total mapped | 375 |',
 '',
 'No completion percentage is assigned: source support, production acceptance, future options and commercial outcomes are different measures and cannot be combined honestly into one “complete” percentage.',
 '',
 'Source identity and SHA-256 provenance are retained in [requirements-375.json](requirements-375.json). Run `npm run check:requirements` to verify all IDs, original text, evidence paths and this generated table. Regenerate only after reviewing actual source changes with `node scripts/check-requirements-traceability.mjs --write`.',
 ];
for(let phase=1;phase<=17;phase++){
 lines.push('',`## Phase ${phase}`,'','| # | Status | Original requirement | Original acceptance | Current implementation / remaining work | Source | Related verification |','|---:|---|---|---|---|---|---|');
 for(const r of data.requirements.filter(r=>r.phase===phase))lines.push(`| ${r.number} | ${labels[r.status]} | ${escape(r.requirement)} | ${escape(r.acceptance)} | ${escape(r.assessment)} | ${links(r.source)} | ${links(r.tests)} |`);
}
const rendered=lines.join('\n')+'\n',target=path.join(root,'docs/roadmap/requirements-375.md');
if(process.argv.includes('--write'))await writeFile(target,rendered);
else if(await readFile(target,'utf8')!==rendered)throw Error('TRACEABILITY_DOCUMENT_STALE');
console.log(JSON.stringify({mapped:375,originalTextSha256:original,counts,individualAcceptanceClaimed:false}));

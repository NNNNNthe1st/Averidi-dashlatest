import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import type {Page} from 'playwright';
export async function verifyComparisons(page:Page,checkAccessibility:(page:Page,phase:string)=>Promise<void>){
 const canvas=page.getByRole('region',{name:'Dashboard results',exact:true});
 await canvas.getByRole('button',{name:'Clear filters',exact:true}).click();await canvas.getByText('$350.00',{exact:true}).first().waitFor();
 await canvas.getByLabel('Filter by',{exact:true}).selectOption('day');await canvas.getByLabel('From',{exact:true}).fill('2026-01-01');await canvas.getByLabel('Through',{exact:true}).fill('2026-01-31');await canvas.getByRole('button',{name:'Apply filter',exact:true}).click();
 await canvas.getByRole('button',{name:'Apply filter',exact:true}).waitFor({state:'visible'});
 await canvas.getByText('More comparison options',{exact:true}).click();
 await canvas.getByLabel('Compare with',{exact:true}).selectOption('PREVIOUS_MONTH');await canvas.getByRole('button',{name:'Apply comparison',exact:true}).click();
 const applied=canvas.getByRole('region',{name:'Applied comparison',exact:true});await applied.getByText('2025-12-31',{exact:false}).waitFor();assert.match(await applied.innerText(),/2025-12-01/);
 await canvas.getByLabel('Compare with',{exact:true}).selectOption('PREVIOUS_YEAR');await canvas.getByRole('button',{name:'Apply comparison',exact:true}).click();await applied.getByText('2025-01-31',{exact:false}).waitFor();
 await canvas.getByLabel('Compare with',{exact:true}).selectOption('CUSTOM');await canvas.getByLabel('Comparison from',{exact:true}).fill('2026-01-01');await canvas.getByLabel('Comparison through',{exact:true}).fill('2026-01-31');await canvas.getByLabel('Current data observed through (optional)',{exact:true}).fill('2026-01-02');await canvas.getByRole('button',{name:'Apply comparison',exact:true}).click();
 await applied.getByText('Both periods use the same elapsed number of observed days.',{exact:true}).waitFor();await canvas.getByText('$150.00',{exact:true}).first().waitFor();assert.match(await applied.innerText(),/2026-01-02 \(2 days\)/);await applied.getByText('The selected comparison overlaps the current period.',{exact:true}).waitFor();
 assert.doesNotMatch(await canvas.locator('article').first().innerText(),/Source processed: Unavailable/);
 await canvas.getByLabel('Filter preset name',{exact:true}).fill('Observed comparison');await canvas.getByRole('button',{name:'Save current filters',exact:true}).click();await canvas.getByText('Filter preset saved.',{exact:true}).waitFor();
 const downloadEvent=page.waitForEvent('download');await canvas.getByRole('button',{name:'Download metric report',exact:true}).click();const download=await downloadEvent;const file=await download.path();assert.ok(file);const report=await readFile(file!,'utf8');assert.match(report,/CUSTOM/);assert.match(report,/Source processed at/);assert.match(report,/Partial period aligned/);
 await checkAccessibility(page,'observed-period-comparison');
 await canvas.getByRole('button',{name:'Clear filters',exact:true}).click();await canvas.getByText('$350.00',{exact:true}).first().waitFor();await canvas.getByLabel('Saved filters',{exact:true}).selectOption({label:'Observed comparison'});await canvas.getByRole('button',{name:'Apply saved filters',exact:true}).click();await canvas.getByText('$150.00',{exact:true}).first().waitFor();await canvas.getByRole('button',{name:'Inspect matching source records',exact:true}).click();const records=canvas.getByRole('region',{name:'Matching source records',exact:true});await records.getByRole('cell',{name:'001',exact:true}).waitFor();await records.getByRole('cell',{name:'002',exact:true}).waitFor();assert.equal(await records.getByRole('row').count(),3);
 await canvas.getByRole('button',{name:'Hide source records',exact:true}).click();await page.setViewportSize({width:390,height:844});await checkAccessibility(page,'observed-period-comparison-mobile');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await canvas.getByRole('button',{name:'Clear filters',exact:true}).click();await canvas.getByText('$350.00',{exact:true}).first().waitFor();await canvas.getByText('More comparison options',{exact:true}).click();await page.setViewportSize({width:1280,height:900});
 console.log('PASS: month/year/custom comparisons, explicit elapsed periods, persisted filters, source records, CSV freshness and desktop/mobile accessibility.');
}

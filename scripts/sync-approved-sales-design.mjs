import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const source=await readFile(new URL('../public/design/sales-dashboard.html',import.meta.url));
const html=source.toString('utf8'),style=html.match(/<style>([\s\S]*?)<\/style>/)?.[1],markup=html.match(/<body>([\s\S]*?)<script>/)?.[1];
if(!style||!markup||!markup.startsWith('<div class="dashboard">')||/<script\b/i.test(markup))throw Error('Unexpected approved design structure; review the source before regenerating.');
const generated='// Approved design from public/design/sales-dashboard.html. Do not restyle this asset.\nexport const approvedSalesSourceSha256='+JSON.stringify(createHash('sha256').update(source).digest('hex'))+';\nexport const approvedSalesStyle='+JSON.stringify(style)+';\nexport const approvedSalesMarkup='+JSON.stringify(markup)+';\n';
const output=new URL('../src/components/sales/approved-sales-design.ts',import.meta.url);
if(process.argv.includes('--check')){if(await readFile(output,'utf8')!==generated)throw Error('Approved Sales design asset is out of sync.');console.log('Approved Sales design asset matches its source exactly.');}else{await writeFile(output,generated);console.log('Approved Sales design asset synchronized without restyling.');}

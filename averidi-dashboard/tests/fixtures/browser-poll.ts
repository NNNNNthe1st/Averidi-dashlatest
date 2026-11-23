import type {Page} from 'playwright';
/** Await network predicates explicitly. A Promise itself is truthy and must
 * never be accepted as evidence that a background job has completed. */
export async function waitForBrowserJson<T>(page:Page,url:string,predicate:(value:T)=>boolean,label:string):Promise<T>{
 const deadline=Date.now()+25000;let last:T|undefined;
 while(Date.now()<deadline){
  const response=await page.evaluate(async target=>{const result=await fetch(target,{cache:'no-store',signal:AbortSignal.timeout(5000)});return {ok:result.ok,body:await result.json()};},url);
  last=response.body as T;if(response.ok&&predicate(last))return last;
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 throw Error(label+' did not complete. Last response: '+JSON.stringify(last).slice(0,2000));
}

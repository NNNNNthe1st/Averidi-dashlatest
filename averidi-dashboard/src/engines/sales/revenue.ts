import type {DashboardPreparedData,DashboardRow} from '../ingestion/ingest';
import type {SalesAnswers,SalesField,SalesProjection,SalesQuestion,SalesRole} from './contracts';
import {salesDecimalOperation} from './decimal-values';

/** Resolve recorded amounts and their explicit accounting treatment together.
 * A known adjustment is applied once; absent amounts never become zero. */
export function resolveSalesRevenue(data:DashboardPreparedData,answers:SalesAnswers,amount:(role:SalesRole)=>SalesField|undefined,quantity:SalesField|undefined){
 const projection:SalesProjection={},questions:SalesQuestion[]=[],evidence:string[]=[],warnings:string[]=[];
 const unused=(base:string)=>{let field=base;while(data.columns.some(c=>c.name===field))field+=' derived';return field;};
 const derived=(field:string,detail:string):SalesField=>({name:field,role:'REVENUE',type:'NUMBER',evidence:detail,use:true});
 let revenue=amount('REVENUE');const gross=amount('GROSS'),discount=amount('DISCOUNT');
 let recorded=(row:DashboardRow):number|null=>revenue&&typeof row[revenue.name]==='number'?row[revenue.name] as number:null;
 if(!revenue&&!gross&&quantity&&data.columns.length<97){
  const price=amount('PRICE');if(price){
   const field=unused('Sales derived recorded amount');projection.revenueFromUnits={quantity:quantity.name,unitPrice:price.name,field};
   revenue=derived(field,`${quantity.name} × ${price.name}; accounting treatment is confirmed separately.`);
   recorded=row=>typeof row[quantity.name]==='number'&&typeof row[price.name]==='number'?salesDecimalOperation(row[quantity.name] as number,row[price.name] as number,'MULTIPLY'):null;
   evidence.push(`Recorded sales = ${quantity.name} × ${price.name}.`);
  }
 }
 const discountReconciles=!!revenue&&!!gross&&!!discount&&data.rows.length>0&&data.rows.every(row=>typeof row[gross.name]==='number'&&typeof row[discount.name]==='number'&&salesDecimalOperation(row[gross.name] as number,row[discount.name] as number,'SUBTRACT')===recorded(row));
 const accountingFacts={discountsAlreadyApplied:answers.discountsAlreadyApplied??(discountReconciles?true:undefined),refundsAlreadyApplied:answers.refundsAlreadyApplied,taxExcluded:answers.taxExcluded,deliveryExcluded:answers.deliveryExcluded};
 const detailKeys=Object.keys(accountingFacts) as (keyof typeof accountingFacts)[];
 const detailed=detailKeys.some(key=>answers[key]!==undefined);
 let netConfirmed=!detailed&&answers.recordedNet===true;
 if(discountReconciles)evidence.push(`${revenue!.name} equals ${gross!.name} minus ${discount!.name} throughout the file; discounts are already deducted.`);
 if(revenue&&!netConfirmed){
  const adjustments=[['discountsAlreadyApplied','DISCOUNT','discount'],['refundsAlreadyApplied','REFUND','refund'],['taxExcluded','TAX','tax'],['deliveryExcluded','SHIPPING','delivery charge']] as const;
  const deductions:SalesField[]=[];let complete=!(answers.recordedNet===false&&!detailed);
  for(const [key,role,label] of adjustments){
   if(accountingFacts[key]===undefined){complete=false;continue;}
   if(accountingFacts[key]===false){const field=amount(role);if(field&&data.rows.length&&data.rows.every(row=>typeof row[field.name]==='number'&&(row[field.name] as number)>=0))deductions.push(field);else{complete=false;warnings.push(`The recorded sales include ${label} amounts that need a separate complete, nonnegative ${label} amount field. Correct the field meaning or supply those amounts.`);}}
  }
  if(complete){
   netConfirmed=true;
   if(deductions.length&&data.columns.length<99){const base=revenue.name,field=unused('Sales derived net amount');projection.netFromGross={gross:base,deductions:deductions.map(f=>f.name),field};revenue=derived(field,'Net sales derived from your separate accounting answers.');evidence.push(`Net sales = ${base}${deductions.map(f=>' − '+f.name).join('')}. Each adjustment is deducted once.`);}
   else if(deductions.length){netConfirmed=false;warnings.push('The file needs space for a derived net-sales field. Remove unused columns before deriving the adjustments.');}
  }
  if(!netConfirmed&&(answers.recordedNet!==false||detailed))for(const [key,label,detail] of [
   ['discountsAlreadyApplied','Have discounts already been subtracted from these sales amounts?','For example, a 100 sale discounted by 10 is recorded as 90. If not, we use a separate discount amount when present.'],
   ['refundsAlreadyApplied','Have any refunds already been subtracted from these sales amounts?','Answer Yes if refunds are included, or you know there were no refunds. If not, we use the separate refund amounts.'],
   ['taxExcluded','Do these sales amounts exclude sales tax?','For example, 100 of sales plus 10 tax is recorded as 100 here. If not, we use the separate tax amounts.'],
   ['deliveryExcluded','Do these sales amounts exclude delivery charges?','Answer Yes when delivery is excluded or does not apply. If not, we use the separate delivery amounts.']
  ] as const)if(accountingFacts[key]===undefined)questions.push({key,kind:'boolean',label,detail});
 }
 // Retain the previously saved gross-to-net contract for sources with no
 // recorded sales column. Its explicit formula confirmation remains required.
 if(!revenue&&gross&&data.columns.length<97){
  const deductions=['DISCOUNT','REFUND','TAX','SHIPPING'].map(role=>amount(role as SalesRole)).filter((f):f is SalesField=>!!f);
  if(answers.deriveNet===undefined)questions.push({key:'deriveNet',kind:'boolean',label:`Can final sales be calculated as “${gross.name}”${deductions.map(f=>` minus “${f.name}”`).join('')}?`,detail:'Confirm these are amounts for the same rows and the result excludes tax/delivery and accounts for discounts/refunds. Percentage discounts need amount values first.'});
  if(answers.deriveNet===true&&deductions.every(f=>data.rows.every(row=>(row[f.name] as number)>=0))){const field=unused('Sales derived net amount');projection.netFromGross={gross:gross.name,deductions:deductions.map(f=>f.name),field};revenue=derived(field,'Derived from the adjustment formula you confirmed.');netConfirmed=true;evidence.push(`Net sales = ${gross.name}${deductions.map(f=>' − '+f.name).join('')}.`);}
 }
 if(revenue&&answers.recordedNet===false&&!detailed)warnings.push('The recorded sales need a net-sales definition. Review the separate discount, refund, tax and delivery answers, or choose a final net-sales column.');
 return {revenue,projection,questions,evidence,warnings,netConfirmed,accountingFacts};
}

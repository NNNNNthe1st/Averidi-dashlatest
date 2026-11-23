/** Bounded base-10 operations for source normalization and derived amounts.
 * Kept browser-safe; no floating-point intermediate enters these operations. */
function parts(value:string|number){
 const text=String(value);if(text.length>128)throw Error('DECIMAL_RANGE');
 const m=/^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);if(!m)throw Error('DECIMAL_FORMAT');
 const exponent=Number(m[4]??0);if(!Number.isSafeInteger(exponent)||Math.abs(exponent)>60)throw Error('DECIMAL_RANGE');
 let coefficient=BigInt((m[1]==='-'?'-':'')+m[2]+(m[3]??'')),scale=(m[3]?.length??0)-exponent;
 if(scale<0){coefficient*=BigInt(10)**BigInt(-scale);scale=0;}if(scale>60)throw Error('DECIMAL_RANGE');
 while(scale>0&&coefficient%BigInt(10)===BigInt(0)){coefficient/=BigInt(10);scale--;}
 return {coefficient,scale};
}
export function sameDecimal(a:string|number,b:string|number){try{const x=parts(a),y=parts(b);return x.coefficient===y.coefficient&&x.scale===y.scale;}catch{return false;}}
export function salesDecimalOperation(a:number,b:number,operation:'ADD'|'SUBTRACT'|'MULTIPLY'):number|null{
 try{const x=parts(a),y=parts(b),scale=operation==='MULTIPLY'?x.scale+y.scale:Math.max(x.scale,y.scale);
 const coefficient=operation==='MULTIPLY'?x.coefficient*y.coefficient:x.coefficient*BigInt(10)**BigInt(scale-x.scale)+(operation==='ADD'?BigInt(1):-BigInt(1))*y.coefficient*BigInt(10)**BigInt(scale-y.scale);
 const negative=coefficient<BigInt(0),raw=(negative?-coefficient:coefficient).toString().padStart(scale+1,'0'),text=(negative?'-':'')+(scale?raw.slice(0,-scale)+'.'+raw.slice(-scale):raw),value=Number(text);
 return Number.isFinite(value)&&sameDecimal(text,value)?value:null;
 }catch{return null;}
}

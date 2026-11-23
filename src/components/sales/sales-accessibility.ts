/** Optional accessible presentation; the approved default stylesheet stays intact. */
export const salesAccessibilityStyle=`
:host([data-sales-contrast="high"]) .kpi p,
:host([data-sales-contrast="high"]) .small-select,
:host([data-sales-contrast="high"]) .small-select span,
:host([data-sales-contrast="high"]) .heat-legend,
:host([data-sales-contrast="high"]) .heat-months,
:host([data-sales-contrast="high"]) .donut span,
:host([data-sales-contrast="high"]) .panel small {color:#344f6c!important}
:host([data-sales-contrast="high"]) .change {color:#174f76!important}
:host([data-sales-contrast="high"]) svg text {fill:#344f6c!important}
:host([data-sales-contrast="high"]) .heat-cell {outline:1px solid #344f6c}
`;
export function salesContrastPreference(){
 if(typeof window==='undefined')return false;
 try{const saved=window.localStorage.getItem('averidi-sales-high-contrast');if(saved!==null)return saved==='true';}catch{}
 return window.matchMedia?.('(prefers-contrast: more)').matches??false;
}
export function saveSalesContrast(value:boolean){try{window.localStorage.setItem('averidi-sales-high-contrast',String(value));}catch{}}

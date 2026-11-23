/** Single extensible vocabulary for recognition, confirmation and canonical projection.
 * Add a concept here (plus its aliases) without changing dataset schemas.
 * Unrecognized or ambiguous aliases never receive automatic approval.
 */
export const DASHBOARD_CONCEPT_REGISTRY=[
 {key:"TIME",aliases:["date","time","timestamp","transaction date","order date","invoice date"]},
 {key:"REVENUE",aliases:["revenue","sales","net sales","gross sales","turnover","gmv","sales amount","sales value"]},
 {key:"PRE_DISCOUNT_SALES",aliases:["pre discount sales amount","sales before discounts"]},
 {key:"REFUND_ELIGIBLE_SALES",aliases:["refund eligible sales amount","eligible sales before refunds"]},
 {key:"GROSS_SOLD_QUANTITY",aliases:["gross sold units before returns","original sold quantity"]},
 {key:"DISCOUNT",aliases:["discount","discount amount","discount total","discounts","promotional discount","coupon discount"]},
 {key:"RETURN_QUANTITY",aliases:["returned quantity","return quantity","returned units","units returned","return qty"]},
 {key:"REFUND",aliases:["refund","refund amount","refund total","refunded amount","refunded value"]},
 {key:"COST",aliases:["cost","cogs","cost of goods sold","expense","expenses"]},
 {key:"PROFIT",aliases:["profit","gross profit","net profit","earnings"]},
 {key:"QUANTITY",aliases:["quantity","qty","units","units sold","volume"]},
 {key:"PRICE",aliases:["price","unit price","selling price","average selling price"]},
 {key:"RATE",aliases:["rate","ratio","margin","percentage","percent","conversion rate"]},
 {key:"ORDER",aliases:["order","order id","order number"]},
 {key:"INVOICE",aliases:["invoice","invoice id","invoice number"]},
 {key:"LINE_ITEM",aliases:["line id","line number","line item id","line item number","order line item id","order line item number","invoice line item id","invoice line item number","order line id","order line number","order item id","order item number","invoice line id","invoice line number","invoice item id","invoice item number"]},
 {key:"SALES_OPPORTUNITY_OPENED",aliases:["opportunity opened date","crm deal opened date","sales opportunity created date"]},
 {key:"SALES_OPPORTUNITY_CLOSED",aliases:["opportunity closed date","crm deal closed date","sales opportunity closed date"]},
 {key:"SALES_OPPORTUNITY_ID",aliases:["sales opportunity id","crm opportunity id","deal id"]},
 {key:"SALES_OPPORTUNITY_STAGE",aliases:["sales opportunity stage","crm opportunity stage","deal outcome"]},
 {key:"SALES_OPPORTUNITY_QUALIFIED",aliases:["sales opportunity qualified","qualified opportunity flag","qualified deal flag"]},
 {key:"SALES_OPEN_PIPELINE_VALUE",aliases:["open opportunity value","qualified open pipeline value","open deal value"]},
 {key:"SALES_REPRESENTATIVE",aliases:["sales representative","sales representative id","sales rep id","salesperson id","salesperson","account executive id"]},
 {key:"CUSTOMER",aliases:["customer","customer id","client","client id","account id","buyer id"]},
 {key:"MARKETING_SPEND",aliases:["marketing spend","ad spend","advertising spend","campaign spend"]},
 {key:"MARKETING_LEADS",aliases:["marketing leads","lead count","qualified leads"]},
 {key:"MARKETING_CONVERSIONS",aliases:["marketing conversions","attributed conversions","conversion count"]},
 {key:"MARKETING_ACQUISITIONS",aliases:["attributed new customers","marketing acquired customers","acquired customer count"]},
 {key:"ATTRIBUTED_REVENUE",aliases:["attributed revenue","ad attributed revenue","campaign attributed revenue"]},
 {key:"OPERATIONS_COMPLETED",aliases:["completed jobs","completed tasks","completed work orders","operations completed"]},
 {key:"OPERATIONS_HOURS",aliases:["labor hours","labour hours","work hours","productive hours"]},
 {key:"OPERATIONS_CYCLE_HOURS",aliases:["cycle time hours","cycle duration hours","processing time hours"]},
 {key:"OPERATIONS_ERRORS",aliases:["error count","defect count","operational errors"]},
 {key:"OPERATIONS_INSPECTED",aliases:["inspected units","checked units","quality inspected units"]},
 {key:"INVENTORY_ON_HAND",aliases:["stock on hand","on hand quantity","inventory on hand","stock level"]},
 {key:"INVENTORY_DEMAND",aliases:["units demanded","demand units","quantity demanded"]},
 {key:"INVENTORY_STOCKOUT",aliases:["stockout flag","out of stock flag","stockout indicator"]},
 {key:"INVENTORY_COGS",aliases:["inventory cogs","inventory cost of goods sold"]},
 {key:"INVENTORY_AVG_VALUE",aliases:["average inventory value","average stock value","mean inventory value"]},
 {key:"INVENTORY_VALUE",aliases:["inventory valuation","inventory value","stock value"]},
 {key:"PRODUCT",aliases:["product","product id","sku","item","item id"]},
 {key:"GEOGRAPHY",aliases:["region","state","country","market","territory","city"]},
 {key:"CHANNEL",aliases:["channel","sales channel","source"]},
 {key:"CUSTOMER_SEGMENT",aliases:["customer segment","customer segment name","customer cohort","customer tier","buyer segment"]},
 {key:"CATEGORY",aliases:["category","segment","department","brand"]},
 {key:"STATUS",aliases:["status","stage"]},
 {key:"IDENTIFIER",aliases:["id","code","key","number","transaction id","transaction number","receipt id","receipt number"]},
 {key:"MEASURE",aliases:["measure","value","amount"]},
 {key:"UNKNOWN",aliases:[]},
] as const;
export type DashboardCanonicalConcept=typeof DASHBOARD_CONCEPT_REGISTRY[number]["key"];
export const DASHBOARD_CANONICAL_CONCEPTS=DASHBOARD_CONCEPT_REGISTRY.map(c=>c.key);
export function dashboardConceptExists(value:string):value is DashboardCanonicalConcept{
 return DASHBOARD_CANONICAL_CONCEPTS.some(key=>key===value);
}
export function dashboardConceptAliases(value:string):readonly string[]{
 return DASHBOARD_CONCEPT_REGISTRY.find(c=>c.key===value)?.aliases??[];
}
const normalize=(value:string)=>value.toLowerCase().trim().replace(/[_-]+/g," ").replace(/\s+/g," ");
/** Exact alias matches only; collisions fail closed. */
export function recognizeDashboardConcept(field:string):DashboardCanonicalConcept|null{
 const input=normalize(field);
 const matched=DASHBOARD_CONCEPT_REGISTRY.filter(c=>c.key!=="UNKNOWN"&&(normalize(c.key)===input||c.aliases.some(a=>normalize(a)===input)));
 return matched.length===1?matched[0].key:null;
}

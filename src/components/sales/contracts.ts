import type {SalesCustomResult} from '../../engines/sales/custom-measures';
import type {SalesAvailability} from '../../engines/sales/availability';
import type {SalesBreakdowns,SalesHierarchy} from '../../engines/sales/hierarchy';
import type {AnalysisQuery} from '../../engines/analysis/pipeline';
import type {DashboardWidgetData} from '../../engines/visualization/widgets';
export type SalesDashboardData=DashboardWidgetData&{
 customMeasures?:SalesCustomResult[];availability?:Record<string,SalesAvailability>;hierarchy?:SalesHierarchy;breakdowns?:SalesBreakdowns;
 dimensionOptions?:Record<'GEOGRAPHY'|'CATEGORY'|'CUSTOMER_SEGMENT',string[]>;
 geographyCountry?:'US'|'OTHER'|'UNKNOWN';
 dateRange?:{start:string;end:string}|null;
 identity?:{workspaceName:string;displayName:string|null};
};
export type SalesDashboardProps={
 demo?:boolean;workspaceId:string;data:SalesDashboardData|null;query:AnalysisQuery;
 loading:boolean;exporting:boolean;error:string;role:string;
 canExport:boolean;canSeeData:boolean;canSeeAnalysis:boolean;canSeeReports:boolean;canSeeMonitoring:boolean;
 highContrast?:boolean;locale?:string;
 onDimension:(concept:'GEOGRAPHY'|'CATEGORY'|'CUSTOMER_SEGMENT',value:string)=>void;
 onDates:(start:string,end:string)=>void;onClearDates:()=>void;
 onBreakdown?:(concept:'GEOGRAPHY'|'CATEGORY',field:string)=>void;onDetails?:()=>void;
 onExport:()=>void;onRetry:()=>void;
 onDrilldown:(field:string|undefined,label:string,missing:boolean)=>void;
};

"use client";
import {dashboardAuthenticatedFetch,refreshDashboardSession} from '../../../../lib/dashboard-authenticated-fetch';
import UnitRulesEditor from '../../../../components/studio/UnitRulesEditor';
import type {UnitRules} from '../../../../engines/metrics/units';
import {useWorkspacePresentation} from '../../../../components/workspace/WorkspacePresentation';
import {useWorkspacePermission} from '../../../../components/workspace/WorkspacePermissions';

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import OnboardingGuide from '../../../../components/studio/OnboardingGuide';
import type {OnboardingAnalysis} from '../../../../features/onboarding/progress';
import SalesSetup from '../../../../components/sales/SalesSetup';
import DatasetAnalysis from '../../../../components/studio/DatasetAnalysis';
import DashboardCanvas from '../../../../components/studio/DashboardCanvas';
import {DASHBOARD_TEMPLATES,type DashboardTemplateKey,type DashboardConfig,type DashboardWidget} from '../../../../engines/generation/dashboard-templates';

type Widget=DashboardWidget;
type Definition=DashboardConfig;
type View = {id:string; name:string; datasetId:string; analysisId:string|null; canEdit?:boolean; definition:Definition; updatedAt:string};
type Dataset = {grainSuggestion?:import("../../../../engines/understanding/row-grain").GrainSuggestion|null;id:string;name:string;status:string;latestVersionId:string|null;metricConfirmationRequired:boolean;suggestedMappings:{sourceField:string;proposedConcept:string}[];confirmedMappings:{sourceField:string;canonicalConcept:string}[];metricRules:Record<string,unknown>|null;analysisStatus?:string|null;pendingVersionId?:string|null};
type DatasetPreview={columns:{name:string;dataType:string}[];preview:Record<string,unknown>[];rowCount:number;duplicateCount:number;profile?:{fields?:Record<string,{missingRate?:number;uniqueRate?:number}>;uncertainDateFields?:string[]}};
const uploadErrors:Record<string,string>={
 FILE_REQUIRED:"Select one CSV, JSON, or Excel file.",
 INVALID_FILE_SIZE:"The file is empty or exceeds the configured file-size limit.",
 BODY_TOO_LARGE:"The file is too large to upload. Use a smaller dataset.",
 UNSUPPORTED_FORMAT:"Use a .csv, .json, or .xlsx file.",
 INVALID_MULTIPART:"The upload was interrupted or malformed. Select the file and try again.",
 STORAGE_UNAVAILABLE:"Storage is temporarily unavailable. Your selected file has not been cleared.",
 UPLOAD_COMMIT_FAILED:"The file was received but the dataset could not be registered. Try again.",
 IMPORT_IN_PROGRESS:"This dataset already has an import in progress. Check its status before retrying.",
 VERSION_CONFLICT:"The dataset changed during this upload. Refresh and try again.",
 SUBSCRIPTION_REQUIRED:"This workspace does not currently have upload access.",
 COMPLETE_SNAPSHOT_REQUIRED:"Synchronization requires confirmation that the file contains the complete record set.",
 INVALID_WORKSHEET:"Choose an Excel worksheet listed in the file.",
 INVALID_CSV_DELIMITER:"Choose a supported CSV separator.",
 CSV_DELIMITER_NOT_APPLICABLE:"CSV separators apply only to CSV files.",
 WORKSHEET_NOT_APPLICABLE:"Excel worksheets apply only to XLSX files.",
 INVALID_TEXT_FIELDS:"Review the fields selected for text preservation, then try again.",
 INVALID_DATASET:"The selected file could not be validated. Check its contents and try again.",
 ACTIVE_SOURCE_INTEGRITY_FAILURE:"The previous dataset could not be verified. Do not overwrite it; contact support.",
 IMPORT_REQUIRES_ACTIVE_VERSION:"Upload a complete dataset before trying to append or synchronize records.",
 COMBINED_DATASET_TOO_LARGE:"The combined dataset exceeds the permitted file size.",
 INVALID_RECORD_IDENTITY:"Specify a valid unique record identifier.",
 RECORD_IDENTITY_REQUIRED:"A unique record identifier is required for append or synchronization.",
 INVALID_RESPONSE:"The server returned an invalid response. Refresh and check dataset history before retrying.",
};
function previewCell(value:unknown,type:string){
  if(type==="DATE"&&typeof value==="string"&&/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(value)){
    const [year,month,day]=value.slice(0,10).split("-");
    return `${day} ${new Intl.DateTimeFormat("en-US",{month:"short",timeZone:"UTC"}).format(new Date(value))} ${year}`;
  }
  return String(value??"");
}
function uploadErrorMessage(body:{error?:string;message?:string},status:number){
 return (status===401?"Your session expired. It may have been refreshed; retry this action. If it fails again, sign in again.":status===403?"Your workspace role does not allow this action.":undefined)??body.message??(body.error&&uploadErrors[body.error])??("Upload failed (HTTP "+status+"). Please try again.");
}
type DatasetVersion={id:string;version:number;status:string;importMode:string;rowCount:number|null;sourceFormat:string;createdAt:string;importSummary:Record<string,unknown>|null};

const readWorkspaceResource=dashboardAuthenticatedFetch;

export default function DashboardStudioPage() {
  const presentation=useWorkspacePresentation();
  const canUpload=useWorkspacePermission('datasets.write'),canAnalyze=useWorkspacePermission('analysis.manage');
  const [layoutResetKey,setLayoutResetKey]=useState(0);
  const [layoutDirty,setLayoutDirty]=useState(false);
  const updateLayoutDirty=useCallback((dirty:boolean)=>setLayoutDirty(dirty),[]);
  const [onboardingAnalysis,setOnboardingAnalysis]=useState<OnboardingAnalysis>(null);
  const updateOnboarding=useCallback((value:OnboardingAnalysis)=>setOnboardingAnalysis(value),[]);
  const params=useParams<{workspaceId:string}>();
  const workspaceId=params.workspaceId;
  const [views,setViews]=useState<View[]>([]);
  const [datasets,setDatasets]=useState<Dataset[]>([]);
  const [uploadDatasetId,setUploadDatasetId]=useState("");
  const [uploadName,setUploadName]=useState("");
  const [uploadFile,setUploadFile]=useState<File|null>(null);
  const [uploadWorksheet,setUploadWorksheet]=useState("");
  const [csvDelimiter,setCsvDelimiter]=useState<"auto"|"comma"|"semicolon"|"tab">("auto");
  const [uploadWorksheets,setUploadWorksheets]=useState<string[]>([]);
  const [uploadBusy,setUploadBusy]=useState(false);
  const [uploadPercent,setUploadPercent]=useState<number|null>(null);
  const [processingUpload,setProcessingUpload]=useState<{datasetId:string;versionId:string}|null>(null);
  const [uploadStage,setUploadStage]=useState<"IDLE"|"REGISTERING"|"TRANSFERRING"|"QUEUED"|"FAILED">("IDLE");
  const [uploadMessage,setUploadMessage]=useState("");
  const [uploadMode,setUploadMode]=useState<"REPLACE"|"APPEND"|"SYNCHRONIZE">("REPLACE");
  const [recordIdentityField,setRecordIdentityField]=useState("");
  const [previewBusy,setPreviewBusy]=useState(false);
  const [uploadPreview,setUploadPreview]=useState<DatasetPreview|null>(null);
  const [preserveTextFields,setPreserveTextFields]=useState<string[]>([]);
  const [historyDatasetId,setHistoryDatasetId]=useState("");
  const [versionHistory,setVersionHistory]=useState<DatasetVersion[]>([]);
  const [activeHistoryVersionId,setActiveHistoryVersionId]=useState<string|null>(null);
  const [rollbackTarget,setRollbackTarget]=useState("");
  const [rollbackBusy,setRollbackBusy]=useState(false);
  const [historyMessage,setHistoryMessage]=useState("");

  const [datasetError,setDatasetError]=useState("");
  const [selectedDataset,setSelectedDataset]=useState("");
  const [selectedTemplate,setSelectedTemplate]=useState<DashboardTemplateKey|null>(null);
  const [studioSection,setStudioSection]=useState<'data'|'create'|'view'>('data');
  const showSetup=studioSection!=='view';
  function openSection(section:'data'|'create'|'view'){
    setStudioSection(section);
    const url=new URL(window.location.href);
    url.searchParams.delete('create');url.searchParams.delete('view');
    url.searchParams.set('section',section);
    window.history.pushState(null,'',url);
  }
  useEffect(()=>{
    const sync=()=>{const query=new URLSearchParams(window.location.search);const section=query.get('section');setStudioSection(section==='view'||section==='create'||section==='data'?section:query.has('create')?'create':query.has('view')?'view':'data');};
    if(new URLSearchParams(window.location.search).has('sales'))setSelectedTemplate('SALES');
    sync();window.addEventListener('popstate',sync);return()=>window.removeEventListener('popstate',sync);
  },[]);
  const [datasetPoll,setDatasetPoll]=useState(0);
  const [datasetsLoading,setDatasetsLoading]=useState(true);
  const [fieldChoices,setFieldChoices]=useState<Record<string,string>>({});
  const [confirmingFields,setConfirmingFields]=useState(false);
  const [confirmationMessage,setConfirmationMessage]=useState("");
  const [ruleChoices,setRuleChoices]=useState<Record<string,string>>({});
  const [unitChoices,setUnitChoices]=useState<UnitRules|null>(null);
  useEffect(()=>{setUnitChoices(null);setFieldChoices({});setRuleChoices({});setConfirmationMessage("");setRulesMessage("");},[selectedDataset]);
  const [savingRules,setSavingRules]=useState(false);
  const [rulesMessage,setRulesMessage]=useState("");
  const [selected,setSelected]=useState<string|null>(null);
  const [newDashboardId,setNewDashboardId]=useState<string|null>(null);
  const [dashboardReadyMessage,setDashboardReadyMessage]=useState("");
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState("");
  const [loadError,setLoadError]=useState(false);
  const [saving,setSaving]=useState(false);
  const [autosavePaused,setAutosavePaused]=useState(false);
  const saveInFlight=useRef(false),latestViews=useRef<View[]>([]);latestViews.current=views;
  const [dirtyIds,setDirtyIds]=useState<string[]>([]);
  const dirtyRef=useRef(dirtyIds);dirtyRef.current=dirtyIds;
  const [reloadKey,setReloadKey]=useState(0);
  const workspaceApi=`/dashboard/app/api/workspaces/${encodeURIComponent(workspaceId)}`;
  const base=`${workspaceApi}/views`;

  useEffect(()=>{
    let active=true;
    // SalesSetup owns its sales-source and view loading. Avoid fetching the
    // general studio resources as well when the Sales flow is active.
    const salesMode=selectedTemplate==='SALES'||new URLSearchParams(window.location.search).has('sales');
    if(salesMode){setLoading(false);return ()=>{active=false;};}
    (async()=>{
      try {
        if(active){setLoadError(false);setMessage("");}
        const response=await readWorkspaceResource(base);
        if(response.status===409)throw new Error("This dashboard changed elsewhere. Reload before saving to avoid overwriting another edit.");
      if(!response.ok) throw new Error(response.status===401?"Your session expired. Sign in again, then retry loading your dashboards.":response.status===403?"Workspace access denied.":response.status===402?"An active Dashboard subscription is required.":"Dashboard views could not be loaded.");
        const data: {views:View[]} = await response.json();
        if(active){setViews(existing=>data.views.map(item=>dirtyRef.current.includes(item.id)?existing.find(row=>row.id===item.id)??item:item));setSelected(previous=>data.views.some(item=>item.id===previous)?previous:data.views.find(item=>item.id===new URLSearchParams(window.location.search).get('view'))?.id??data.views[0]?.id??null);}
      } catch(error) {
        if(active){setLoadError(true);setMessage(error instanceof Error?error.message:"Unable to load dashboard views.");}
      } finally {if(active)setLoading(false);}
    })();
    return ()=>{active=false;};
  },[base,reloadKey,selectedTemplate]);

  useEffect(()=>{
    let active=true;
    const salesMode=selectedTemplate==='SALES'||new URLSearchParams(window.location.search).has('sales');
    if(salesMode){setDatasetsLoading(false);return ()=>{active=false;};}
    setDatasetError("");setDatasetsLoading(true);
    readWorkspaceResource(`${workspaceApi}/datasets`)
      .then(async response=>{
        if(!response.ok)throw new Error(response.status===401?"Sign in to view datasets.":response.status===402?"An active Dashboard subscription is required.":response.status===403?"Dataset access denied.":"Unable to load workspace datasets.");
        return response.json() as Promise<{datasets:Dataset[]}>;
      })
      .then(data=>{if(active){setDatasets(data.datasets);setHistoryDatasetId(previous=>data.datasets.some(item=>item.id===previous)?previous:data.datasets[0]?.id??"");setSelectedDataset(previous=>data.datasets.some(item=>item.id===previous&&item.status==="READY")?previous:data.datasets.find(item=>item.status==="READY")?.id??"");}})
      .catch(error=>{if(active){setDatasetError(error instanceof Error?error.message:"Unable to load datasets. Previously loaded data is retained; retry when your session is available.");}})
      .finally(()=>{if(active)setDatasetsLoading(false);});
    return ()=>{active=false;};
  },[workspaceApi,reloadKey,datasetPoll,selectedTemplate]);

  async function uploadData(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();
    const formElement=event.currentTarget;
    if(!canUpload||uploadBusy||processingUpload||!uploadFile)return;
    if(!uploadPreview){setUploadMessage("Automatic data inspection has not completed. Please check the file message.");return;}
    if(!uploadDatasetId&&!uploadName.trim()){setUploadMessage("Enter a dataset name or select an existing dataset.");return;}
    if(uploadMode!=="REPLACE"&&(!uploadDatasetId||!recordIdentityField.trim())){setUploadMessage("Appending requires an existing dataset and a record identity field.");return;}
    setUploadBusy(true);setUploadPercent(null);setUploadStage("REGISTERING");setUploadMessage("");
    try{
      let datasetId=uploadDatasetId;
      if(!datasetId){
        const created=await dashboardAuthenticatedFetch(`${workspaceApi}/datasets`,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:uploadName.trim()})});
        if(!created.ok)throw new Error("Dataset could not be created. Check subscription and edit permissions.");
        const body:{dataset:{id:string}}=await created.json();
        datasetId=body.dataset.id;
        // Retain the created destination even when transfer fails or is interrupted.
        setUploadDatasetId(datasetId);
        setDatasets(previous=>previous.some(item=>item.id===datasetId)?previous:[...previous,{...body.dataset,id:datasetId,name:uploadName.trim(),status:'PENDING',latestVersionId:null,pendingVersionId:null,metricConfirmationRequired:true,suggestedMappings:[],confirmedMappings:[],metricRules:null}]);
      }
      const form=new FormData();
      form.set("file",uploadFile);
      if(csvDelimiter!=="auto"&&uploadFile.name.toLowerCase().endsWith(".csv"))form.set("csvDelimiter",csvDelimiter);
      form.set("preserveTextFields",JSON.stringify(preserveTextFields));
      if(uploadWorksheet.trim())form.set("worksheet",uploadWorksheet);
      form.set("mode",uploadMode);
      if(uploadMode!=="REPLACE")form.set("recordIdentityField",recordIdentityField.trim());
      if(uploadMode==="SYNCHRONIZE")form.set("completeSnapshot","true");
      setUploadStage("TRANSFERRING");
      const uploaded=await new Promise<{ok:boolean;status:number;json:()=>Promise<any>}>((resolve,reject)=>{
        const xhr=new XMLHttpRequest();
        xhr.open("POST",`${workspaceApi}/datasets/${encodeURIComponent(datasetId)}/versions`);
        xhr.withCredentials=true;
        xhr.upload.onprogress=event=>{if(event.lengthComputable)setUploadPercent(Math.min(100,Math.round(100*event.loaded/event.total)));};
        xhr.onerror=()=>reject(new Error("Network interrupted. File selection was retained for retry."));
        xhr.onabort=()=>reject(new Error("Upload was cancelled. File selection was retained."));
        xhr.onload=async()=>{
          if(xhr.status===401)await refreshDashboardSession();
          resolve({ok:xhr.status>=200&&xhr.status<300,status:xhr.status,json:async()=>{try{return JSON.parse(xhr.responseText)}catch{return {error:"INVALID_RESPONSE"}}}});};
        xhr.send(form);
      });
      if(!uploaded.ok){
        if(!uploadDatasetId)setUploadDatasetId(datasetId);
        const data:{error?:string;message?:string;worksheets?:string[]}=await uploaded.json().catch(()=>({}));
        if(Array.isArray(data.worksheets))setUploadWorksheets(data.worksheets.filter(name=>typeof name==='string'));
        throw new Error(`${uploadErrorMessage(data,uploaded.status)} ${!uploadDatasetId?"The dataset is selected and ready for another attempt.":""}`);
      }
      const receipt=await uploaded.json() as {version?:{id?:string}};
      setUploadPercent(100);
      if(receipt.version?.id)setProcessingUpload({datasetId,versionId:receipt.version.id});
      setUploadStage("QUEUED");
      setPreserveTextFields([]);setUploadDatasetId("");setUploadMode("REPLACE");setRecordIdentityField("");
      setUploadName("");setUploadFile(null);setUploadWorksheet("");setUploadWorksheets([]);setUploadPreview(null);setUploadMessage("File received. We’re checking your data.");setReloadKey(key=>key+1);
      formElement.reset();
    }catch(error){setUploadPercent(null);setUploadStage("FAILED");setUploadMessage(error instanceof Error?error.message:"Unable to upload dataset.");setReloadKey(key=>key+1);}
    finally{setUploadBusy(false);}
  }

  useEffect(()=>{
    if(!processingUpload)return;
    let stopped=false;
    let timer:ReturnType<typeof setTimeout>;
    async function check(){
      try{
        const response=await dashboardAuthenticatedFetch(`${workspaceApi}/datasets/${encodeURIComponent(processingUpload!.datasetId)}/versions`,{credentials:"same-origin",cache:"no-store"});
        if(!response.ok)throw new Error("Unable to retrieve dataset processing status.");
        const data=await response.json() as {versions:Array<{id:string;status:string}>};
        if(stopped)return;
        const version=data.versions.find(item=>item.id===processingUpload!.versionId);
        if(!version){setUploadMessage("The uploaded version could not be found. Refresh the dataset list.");setUploadStage("FAILED");setProcessingUpload(null);return;}
        if(version.status==="READY"){setSelectedDataset(processingUpload!.datasetId);setHistoryDatasetId(processingUpload!.datasetId);setUploadMessage("Data is ready. Select Create a dashboard to choose a dashboard type and review the calculation details.");setUploadStage("IDLE");setProcessingUpload(null);setReloadKey(key=>key+1);return;}
        if(version.status==="FAILED"||version.status==="REJECTED"||version.status==="CANCELLED"){setUploadMessage("Dataset processing failed. Review its version history before retrying.");setUploadStage("FAILED");setProcessingUpload(null);return;}
      }catch(error){if(!stopped)setUploadMessage(error instanceof Error?error.message:"Unable to check processing status.");}
      if(!stopped)timer=setTimeout(check,2500);
    }
    void check();
    return ()=>{stopped=true;clearTimeout(timer);};
  },[processingUpload,workspaceApi]);


  async function previewUpload(){
    if(!canUpload||!uploadFile||previewBusy||uploadBusy)return;
    setPreviewBusy(true);setUploadMessage("");setUploadPreview(null);
    try{
      const form=new FormData();form.set("file",uploadFile);
      form.set("preserveTextFields",JSON.stringify(preserveTextFields));
      if(csvDelimiter!=="auto"&&uploadFile.name.toLowerCase().endsWith(".csv"))form.set("csvDelimiter",csvDelimiter);
      if(uploadWorksheet.trim())form.set("worksheet",uploadWorksheet);
      const response=await dashboardAuthenticatedFetch(`${workspaceApi}/datasets/preview`,{method:"POST",credentials:"same-origin",body:form});
      if(!response.ok){const body:{error?:string;message?:string;worksheets?:string[]}=await response.json().catch(()=>({}));if(Array.isArray(body.worksheets))setUploadWorksheets(body.worksheets.filter(name=>typeof name==='string'));throw new Error(uploadErrorMessage(body,response.status));}
      const data:DatasetPreview=await response.json();setUploadPreview(data);
    }catch(error){setUploadMessage(error instanceof Error?error.message:"Preview unavailable.");}
    finally{setPreviewBusy(false);}
  }

  // Automatic, cancellable file inspection. Only changes to interpretation inputs
  // invalidate the preview; the upload endpoint receives these same options.
  useEffect(()=>{
    if(!canUpload||!uploadFile||uploadBusy){if(!uploadFile){setUploadPreview(null);setPreviewBusy(false);}return;}
    const controller=new AbortController();
    setUploadPreview(null);
    setPreviewBusy(true);
    setUploadMessage("");
    const timer=setTimeout(async()=>{
      try{
        const form=new FormData();
        form.set("file",uploadFile);
        form.set("preserveTextFields",JSON.stringify(preserveTextFields));
        if(csvDelimiter!=="auto"&&uploadFile.name.toLowerCase().endsWith(".csv"))form.set("csvDelimiter",csvDelimiter);
        if(uploadWorksheet.trim())form.set("worksheet",uploadWorksheet);
        const response=await dashboardAuthenticatedFetch(`${workspaceApi}/datasets/preview`,{method:"POST",credentials:"same-origin",body:form,signal:controller.signal});
        if(!response.ok){
          const body:{error?:string;message?:string;worksheets?:string[]}=await response.json().catch(()=>({}));
          if(!controller.signal.aborted&&Array.isArray(body.worksheets))setUploadWorksheets(body.worksheets.filter(name=>typeof name==="string"));
          throw new Error(uploadErrorMessage(body,response.status));
        }
        const data:DatasetPreview=await response.json();
        if(!controller.signal.aborted)setUploadPreview(data);
      }catch(error){
        if(!controller.signal.aborted)setUploadMessage(error instanceof Error?error.message:"Unable to inspect this file.");
      }finally{if(!controller.signal.aborted)setPreviewBusy(false);}
    },300);
    return ()=>{clearTimeout(timer);controller.abort();};
  },[uploadFile,uploadWorksheet,csvDelimiter,preserveTextFields,workspaceApi,canUpload]);

  useEffect(()=>{
    let active=true;
    if(!historyDatasetId){setVersionHistory([]);setActiveHistoryVersionId(null);return;}
    dashboardAuthenticatedFetch(`${workspaceApi}/datasets/${encodeURIComponent(historyDatasetId)}/versions`,{credentials:"same-origin",cache:"no-store"})
      .then(async response=>{if(!response.ok)throw new Error("Unable to load version history.");return response.json() as Promise<{activeVersionId:string|null;versions:DatasetVersion[]}>;})
      .then(data=>{if(active){setVersionHistory(data.versions);setActiveHistoryVersionId(data.activeVersionId);setRollbackTarget(previous=>data.versions.some(v=>v.id===previous&&v.status==="READY")?previous:data.activeVersionId??"");}})
      .catch(error=>{if(active)setHistoryMessage(error instanceof Error?error.message:"History unavailable.");});
    return ()=>{active=false;};
  },[workspaceApi,historyDatasetId,reloadKey]);

  async function restoreVersion(){
    if(!historyDatasetId||!rollbackTarget||rollbackBusy)return;
    if(!window.confirm("Restore this previously verified dataset version? Any pending import will be cancelled."))return;
    setRollbackBusy(true);setHistoryMessage("");
    try{
      const response=await dashboardAuthenticatedFetch(`${workspaceApi}/datasets/${encodeURIComponent(historyDatasetId)}/rollback`,{
        method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({versionId:rollbackTarget}),
      });
      if(!response.ok){const body:{error?:string}=await response.json().catch(()=>({}));throw new Error(`Restore failed (${body.error??response.status})`);}
      setHistoryMessage("Verified dataset version restored.");setReloadKey(value=>value+1);
    }catch(error){setHistoryMessage(error instanceof Error?error.message:"Unable to restore version.");}
    finally{setRollbackBusy(false);}
  }

  const datasetForReview=datasets.find(dataset=>dataset.id===selectedDataset);
  const fieldConcepts=["REVENUE","COST","QUANTITY","ORDER","SALES_REPRESENTATIVE","SALES_OPPORTUNITY_OPENED","SALES_OPPORTUNITY_CLOSED","SALES_OPPORTUNITY_ID","SALES_OPPORTUNITY_STAGE","SALES_OPPORTUNITY_QUALIFIED","SALES_OPEN_PIPELINE_VALUE","INVOICE","LINE_ITEM","CUSTOMER","PRODUCT","TIME","CATEGORY","CHANNEL","CUSTOMER_SEGMENT","GEOGRAPHY","STATUS","REFUND","DISCOUNT","RETURN_QUANTITY","PRE_DISCOUNT_SALES","REFUND_ELIGIBLE_SALES","GROSS_SOLD_QUANTITY","MARKETING_SPEND","MARKETING_LEADS","MARKETING_CONVERSIONS","MARKETING_ACQUISITIONS","ATTRIBUTED_REVENUE","INVENTORY_ON_HAND","INVENTORY_DEMAND","INVENTORY_STOCKOUT","INVENTORY_COGS","INVENTORY_AVG_VALUE","INVENTORY_VALUE","OPERATIONS_COMPLETED","OPERATIONS_HOURS","OPERATIONS_CYCLE_HOURS","OPERATIONS_ERRORS","OPERATIONS_INSPECTED","IDENTIFIER","IGNORE"] as const;
  const view=views.find(x=>x.id===selected);
  const ruleFields=[
    {key:"grain",label:"What does one row represent?",choices:["ORDER","ORDER_ITEM","INVOICE","INVOICE_ITEM","TRANSACTION","CUSTOMER","PRODUCT","DAY","PERIOD","RECORD"]},
    {key:"rowAmountsConfirmed",label:"All monetary inputs are per line, not repeated document totals (line-item data)",choices:["true","false"]},
    {key:"currencyMode",label:"Currency structure",choices:["SINGLE","MULTI","UNSPECIFIED"]},
    {key:"revenueBasis",label:"Revenue basis",choices:["NET","GROSS","UNKNOWN"]},
    {key:"costBasis",label:"Cost basis",choices:["COGS","UNKNOWN"]},
    {key:"refundsIncluded",label:"Refunds already included in revenue?",choices:["true","false","unknown"]},
    {key:"discountsIncluded",label:"Discounts already included in revenue?",choices:["true","false","unknown"]},
    {key:"taxIncluded",label:"Tax already included in revenue?",choices:["true","false","unknown"]},
    {key:"shippingIncluded",label:"Shipping already included in revenue?",choices:["true","false","unknown"]},
    {key:"cancellationTreatment",label:"Cancelled orders",choices:["UNKNOWN","ALREADY_EXCLUDED","EXCLUDE_ROWS"]},
    {key:"returnTreatment",label:"Returned units",choices:["UNKNOWN","ALREADY_NETTED","DEDUCT_RETURNED_UNITS"]},
    {key:"salesCycleBasisConfirmed",label:"Sales-cycle dates are complete for all qualified closed opportunities, with calendar-day elapsed durations",choices:["true","false"]},
    {key:"salesForecastBasisConfirmed",label:"Complete and consistently spaced daily sales history for historical forecast evaluation",choices:["true","false"]},
    {key:"salesVolatilityPeriodConfirmed",label:"Sales history fully covers the selected consecutive calendar days including zero-sales days",choices:["true","false"]},
    {key:"salesGrowthContributionBasisConfirmed",label:"Segment growth periods are complete, comparable and share the same revenue basis",choices:["true","false"]},
    {key:"salesPriceVolumeBasisConfirmed",label:"Product price/volume periods use comparable net revenue, consistent units and matching products",choices:["true","false"]},
    {key:"salesOpportunityCohortConfirmed",label:"Opportunities are unique, complete, and their qualification and stage classifications are confirmed",choices:["true","false"]},
    {key:"salesPipelineSnapshotConfirmed",label:"Open opportunity amounts represent one current snapshot in the sales target currency and period",choices:["true","false"]},
    {key:"salesRepresentativeAttributionConfirmed",label:"Every sales amount belongs to exactly one accountable representative and is not duplicated",choices:["true","false"]},
    {key:"salesPlanningBasisConfirmed",label:"Targets, budget, and selling days match the specified period and entire sales population",choices:["true","false"]},
    {key:"salesConcentrationConcept",label:"Top-N sales grouping (confirmed uploaded field)",choices:["CUSTOMER","PRODUCT","CHANNEL","GEOGRAPHY","CATEGORY"]},
    {key:"salesDiscountBasisConfirmed",label:"Discount and pre-discount sales amounts are comparable, complete, and not repeated",choices:["true","false"]},
    {key:"salesRefundBasisConfirmed",label:"Refunds and eligible pre-refund sales share the same period/population",choices:["true","false"]},
    {key:"salesReturnBasisConfirmed",label:"Returned units and original gross sold units share the same period/population",choices:["true","false"]},
    {key:"customerHistoryConfirmed",label:"Loaded history contains complete purchases for this customer population and the observation periods",choices:["true","false"]},
    {key:"marketingAttribution",label:"Marketing attribution (source-reported only)",choices:["UNCONFIRMED","SOURCE_REPORTED"]},
    {key:"marketingAcquisitionsConfirmed",label:"Acquisition counts are source-attributed unique NEW customers without overlap across rows",choices:["true","false"]},
    {key:"marketingSpendDeduplicated",label:"Marketing spend occurs once per source row (no campaign spend repeated per conversion)",choices:["true","false"]},
    {key:"inventorySnapshotConfirmed",label:"Inventory data is a current stock snapshot (not accumulated history)",choices:["true","false"]},
    {key:"inventorySnapshotUniqueProducts",label:"Exactly one row per product in this snapshot",choices:["true","false"]},
    {key:"inventoryTurnoverPeriodConfirmed",label:"Period COGS and average inventory valuation cover the same period",choices:["true","false"]},
    {key:"operationsPeriodConfirmed",label:"Operations measures cover the same reporting period and are not duplicated",choices:["true","false"]},
    {key:"operationsHoursBasisConfirmed",label:"Labor hours refer to the same completed-work period",choices:["true","false"]},
    {key:"operationsCycleTimeBasisConfirmed",label:"Cycle hours are total hours for the completed jobs counted",choices:["true","false"]},
    {key:"operationsErrorsAreDefectiveUnits",label:"Operational errors count distinct defective inspected units (not incidents)",choices:["true","false"]},
  ];
  const essentialRuleKeys=new Set(["grain","currencyMode","revenueBasis","costBasis","refundsIncluded","discountsIncluded","taxIncluded","shippingIncluded","cancellationTreatment","returnTreatment"]);
  const applicableRuleFields=ruleFields.filter(field=>essentialRuleKeys.has(field.key)||selectedTemplate==="SALES"&&field.key.startsWith("sales")||selectedTemplate==="CUSTOMER"&&field.key==="customerHistoryConfirmed"||selectedTemplate==="MARKETING"&&field.key.startsWith("marketing")||selectedTemplate==="INVENTORY"&&field.key.startsWith("inventory")||selectedTemplate==="OPERATIONS"&&field.key.startsWith("operations"));
  const optionalRuleFields=applicableRuleFields.filter(field=>!essentialRuleKeys.has(field.key));
    function savedRuleValue(key:string){const value=datasetForReview?.metricRules?.[key];return value===null?"unknown":value===undefined?"":String(value);}
  async function saveMetricRules(){
    if(!canAnalyze||!datasetForReview?.latestVersionId||savingRules)return;
    const chosen=Object.fromEntries(ruleFields.map(field=>[field.key,ruleChoices[field.key]||(savedRuleValue(field.key)||(field.key==="marketingAttribution"?"UNCONFIRMED":["customerHistoryConfirmed","rowAmountsConfirmed","salesPlanningBasisConfirmed","salesRepresentativeAttributionConfirmed","salesOpportunityCohortConfirmed","salesCycleBasisConfirmed","salesPriceVolumeBasisConfirmed","salesForecastBasisConfirmed","salesVolatilityPeriodConfirmed","salesGrowthContributionBasisConfirmed","salesPipelineSnapshotConfirmed","salesDiscountBasisConfirmed","salesRefundBasisConfirmed","salesReturnBasisConfirmed","marketingAcquisitionsConfirmed","marketingSpendDeduplicated","inventorySnapshotConfirmed","inventorySnapshotUniqueProducts","inventoryTurnoverPeriodConfirmed","operationsPeriodConfirmed","operationsHoursBasisConfirmed","operationsCycleTimeBasisConfirmed","operationsErrorsAreDefectiveUnits"].includes(field.key)?"false":""))]));
    if(["grain","currencyMode","revenueBasis","costBasis","refundsIncluded","discountsIncluded","taxIncluded","shippingIncluded","cancellationTreatment","returnTreatment"].some(key=>!chosen[key])){setRulesMessage("Review the core calculation details before saving.");return;}
    const currencyMode=chosen.currencyMode;
    const currency=currencyMode==="SINGLE"?(ruleChoices.currency??String(datasetForReview.metricRules?.currency??presentation?.currency??"")).trim().toUpperCase():null;
    if(currencyMode==="SINGLE"&&!/^[A-Z]{3}$/.test(currency??"")){setRulesMessage("Enter the three-letter currency code.");return;}
    const booleanChoice=(value:string)=>value==="unknown"?null:value==="true";
    const input={units:unitChoices??datasetForReview.metricRules?.units??{},customerHistoryConfirmed:chosen.customerHistoryConfirmed==="true",salesDiscountBasisConfirmed:chosen.salesDiscountBasisConfirmed==="true",salesRefundBasisConfirmed:chosen.salesRefundBasisConfirmed==="true",salesReturnBasisConfirmed:chosen.salesReturnBasisConfirmed==="true",salesPlanningBasisConfirmed:chosen.salesPlanningBasisConfirmed==="true",salesRepresentativeAttributionConfirmed:chosen.salesRepresentativeAttributionConfirmed==="true",salesOpportunityCohortConfirmed:chosen.salesOpportunityCohortConfirmed==="true",salesPipelineSnapshotConfirmed:chosen.salesPipelineSnapshotConfirmed==="true",salesCycleBasisConfirmed:chosen.salesCycleBasisConfirmed==="true",salesPriceVolumeBasisConfirmed:chosen.salesPriceVolumeBasisConfirmed==="true",salesVolatilityPeriodConfirmed:chosen.salesVolatilityPeriodConfirmed==="true",salesGrowthContributionBasisConfirmed:chosen.salesGrowthContributionBasisConfirmed==="true",salesForecastBasisConfirmed:chosen.salesForecastBasisConfirmed==="true",salesForecastSeasonDays:(ruleChoices.salesForecastSeasonDays??savedRuleValue("salesForecastSeasonDays"))?Number(ruleChoices.salesForecastSeasonDays??savedRuleValue("salesForecastSeasonDays")):undefined,salesForecastHorizonDays:(ruleChoices.salesForecastHorizonDays??savedRuleValue("salesForecastHorizonDays"))?Number(ruleChoices.salesForecastHorizonDays??savedRuleValue("salesForecastHorizonDays")):undefined,salesCohortMonth:(ruleChoices.salesCohortMonth??savedRuleValue("salesCohortMonth"))||undefined,salesTargetAmount:(ruleChoices.salesTargetAmount??savedRuleValue("salesTargetAmount"))!==""?Number(ruleChoices.salesTargetAmount??savedRuleValue("salesTargetAmount")):undefined,salesBudgetAmount:(ruleChoices.salesBudgetAmount??savedRuleValue("salesBudgetAmount"))!==""?Number(ruleChoices.salesBudgetAmount??savedRuleValue("salesBudgetAmount")):undefined,salesEligibleSellingDays:(ruleChoices.salesEligibleSellingDays??savedRuleValue("salesEligibleSellingDays"))!==""?Number(ruleChoices.salesEligibleSellingDays??savedRuleValue("salesEligibleSellingDays")):undefined,salesPlanningPeriodStart:(ruleChoices.salesPlanningPeriodStart??savedRuleValue("salesPlanningPeriodStart"))||undefined,salesPlanningPeriodEnd:(ruleChoices.salesPlanningPeriodEnd??savedRuleValue("salesPlanningPeriodEnd"))||undefined,salesConcentrationConcept:chosen.salesConcentrationConcept||undefined,salesTopN:(ruleChoices.salesTopN??savedRuleValue("salesTopN"))?Number(ruleChoices.salesTopN??savedRuleValue("salesTopN")):undefined,versionId:datasetForReview.latestVersionId,grain:chosen.grain,currency,currencyMode,
      revenueBasis:chosen.revenueBasis,costBasis:chosen.costBasis,
      refundsIncluded:booleanChoice(chosen.refundsIncluded),discountsIncluded:booleanChoice(chosen.discountsIncluded),
      taxIncluded:booleanChoice(chosen.taxIncluded),shippingIncluded:booleanChoice(chosen.shippingIncluded),timezone:(ruleChoices.timezone??String(datasetForReview.metricRules?.timezone??presentation?.timezone??"")).trim()||null,
      cancellationTreatment:chosen.cancellationTreatment,returnTreatment:chosen.returnTreatment,rowAmountsConfirmed:chosen.rowAmountsConfirmed==="true",
      marketingAttribution:chosen.marketingAttribution,marketingSpendDeduplicated:chosen.marketingSpendDeduplicated==="true",marketingAcquisitionsConfirmed:chosen.marketingAcquisitionsConfirmed==="true",
      inventorySnapshotConfirmed:chosen.inventorySnapshotConfirmed==="true",inventorySnapshotUniqueProducts:chosen.inventorySnapshotUniqueProducts==="true",
      inventoryTurnoverPeriodConfirmed:chosen.inventoryTurnoverPeriodConfirmed==="true",
      operationsPeriodConfirmed:chosen.operationsPeriodConfirmed==="true",operationsHoursBasisConfirmed:chosen.operationsHoursBasisConfirmed==="true",
      operationsCycleTimeBasisConfirmed:chosen.operationsCycleTimeBasisConfirmed==="true",operationsErrorsAreDefectiveUnits:chosen.operationsErrorsAreDefectiveUnits==="true",

      inventoryDemandPeriodDays:(ruleChoices.inventoryDemandPeriodDays??savedRuleValue("inventoryDemandPeriodDays"))?Number(ruleChoices.inventoryDemandPeriodDays??savedRuleValue("inventoryDemandPeriodDays")):undefined,
      inventoryLeadTimeDays:(ruleChoices.inventoryLeadTimeDays??savedRuleValue("inventoryLeadTimeDays"))?Number(ruleChoices.inventoryLeadTimeDays??savedRuleValue("inventoryLeadTimeDays")):undefined,
      inventorySafetyDays:(ruleChoices.inventorySafetyDays??savedRuleValue("inventorySafetyDays"))?Number(ruleChoices.inventorySafetyDays??savedRuleValue("inventorySafetyDays")):undefined};
    setSavingRules(true);setRulesMessage("");
    try{
      const response=await dashboardAuthenticatedFetch(`${workspaceApi}/datasets/${encodeURIComponent(datasetForReview.id)}/confirm-metric-rules`,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify(input)});
      if(!response.ok)throw new Error(response.status===409?"The dataset version changed. Reload and review the rules again.":response.status===403?"Workspace edit permission required.":response.status===402?"An active Dashboard subscription is required.":"The business rules could not be saved.");
      setRuleChoices({});setRulesMessage("Calculation details saved. Analyze your data below to validate these decisions.");setReloadKey(key=>key+1);
    }catch(error){setRulesMessage(error instanceof Error?error.message:"Unable to save business rules.");}
    finally{setSavingRules(false);}
  }
  async function saveFieldConfirmations(){
    if(!canAnalyze||!datasetForReview?.latestVersionId||confirmingFields||!datasetForReview.suggestedMappings.length)return;
    const mappings=datasetForReview.suggestedMappings.flatMap(field=>{
      const concept=fieldChoices[field.sourceField]??datasetForReview.confirmedMappings.find(item=>item.sourceField===field.sourceField)?.canonicalConcept??(fieldConcepts.includes(field.proposedConcept as typeof fieldConcepts[number])?field.proposedConcept:undefined);
      return concept?[{sourceField:field.sourceField,canonicalConcept:concept}]:[];
    });
    if(!mappings.length){setConfirmationMessage("Select at least one field meaning before saving.");return;}
    setConfirmingFields(true);setConfirmationMessage("");
    try{
      const response=await dashboardAuthenticatedFetch(`${workspaceApi}/datasets/${encodeURIComponent(datasetForReview.id)}/confirm-fields`,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({versionId:datasetForReview.latestVersionId,mappings})});
      if(!response.ok)throw new Error(response.status===409?"A newer dataset version exists. Reload before confirming fields.":response.status===403?"You need workspace edit permissions.":response.status===402?"An active Dashboard subscription is required.":"Field choices could not be saved.");
      setConfirmationMessage("Field meanings confirmed. Review any calculation details needed for your data, then analyze it below.");
      setReloadKey(key=>key+1);
    }catch(error){setConfirmationMessage(error instanceof Error?error.message:"Field confirmation failed.");}
    finally{setConfirmingFields(false);}
  }
  function reloadDashboards(){
    if(saving)return;
    if((dirtyIds.length||layoutDirty)&&!window.confirm("Discard unsaved changes and reload dashboards?"))return;
    setAutosavePaused(false);setLayoutResetKey(n=>n+1);setDirtyIds([]);setMessage("");setLoadError(false);setLoading(true);setReloadKey(key=>key+1);
  }
  // Only navigate after the newly generated dashboard has actually loaded.
  // Prevent scrolling to stale content or interrupting ordinary dashboard changes.
  useEffect(()=>{
    if(!newDashboardId||loading||loadError||view?.id!==newDashboardId)return;
    const target=document.getElementById("finished-dashboard");
    if(!target)return;
    target.scrollIntoView({behavior:"smooth",block:"start"});
    target.focus({preventScroll:true});
    setDashboardReadyMessage("Your dashboard is ready. You can explore its results below.");
    setNewDashboardId(null);
  },[newDashboardId,loading,loadError,view?.id]);
  function selectDashboard(next:string){
    if(saving)return;
    if(selected&&(dirtyIds.includes(selected)||layoutDirty)&&!window.confirm("Discard unsaved changes to this dashboard?"))return;
    setDirtyIds(ids=>ids.filter(id=>id!==selected));
    setAutosavePaused(false);setMessage("");setLayoutDirty(false);setSelected(next);
  }
  async function saveChanges(automatic:unknown=false) {
    if(!view||view.canEdit===false||saveInFlight.current||saving||loading||loadError||automatic===true&&autosavePaused)return;
    if(!view.definition.name.trim()||view.definition.widgets.some(widget=>!widget.title.trim())){
      setMessage("Dashboard and widget names cannot be empty.");return;
    }
    const snapshot=JSON.stringify(view.definition);saveInFlight.current=true;setAutosavePaused(false);
    setSaving(true);setMessage("");
    try{
      const response=await dashboardAuthenticatedFetch(`${base}/${encodeURIComponent(view.id)}`,{
        method:"PATCH",credentials:"same-origin",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({definition:view.definition,expectedUpdatedAt:view.updatedAt}),
      });
      if(!response.ok) throw new Error(response.status===401?"Please sign in before saving.":response.status===403?"You do not have edit permission.":response.status===402?"An active Dashboard subscription is required.":response.status===409?"This dashboard was changed in another session. Reload it before editing again.":response.status===400?"The dashboard contains an invalid name or widget configuration.":"Unable to save changes.");
      const saved:{updatedAt:string|null}=await response.json();
      if(!saved.updatedAt)throw new Error("Save confirmation did not include a revision. Reload before editing further.");
      setViews(existing=>existing.map(x=>x.id===view.id?{...x,updatedAt:saved.updatedAt!}:x));
      if(JSON.stringify(latestViews.current.find(v=>v.id===view.id)?.definition)===snapshot)setDirtyIds(ids=>ids.filter(id=>id!==view.id));
      setMessage("Changes saved.");
    } catch(error){setAutosavePaused(true);setMessage(error instanceof Error?error.message:"Unable to save changes.");}
    finally{saveInFlight.current=false;setSaving(false);}
  }
  const autoSaveAction=useRef(saveChanges);autoSaveAction.current=saveChanges;
  useEffect(()=>{
    if(!view||!dirtyIds.includes(view.id)||view.canEdit===false||saving||loading||loadError||autosavePaused||!view.definition.name.trim()||view.definition.widgets.some(w=>!w.title.trim()))return;
    const timer=setTimeout(()=>void autoSaveAction.current(true),900);return()=>clearTimeout(timer);
  },[view,dirtyIds,saving,loading,loadError,autosavePaused]);
  function markDirty(){if(selected)setDirtyIds(ids=>ids.includes(selected)?ids:[...ids,selected]);}
  function updateName(name:string){
    markDirty();
    setViews(existing=>existing.map(x=>x.id===selected?{...x,name,definition:{...x.definition,name}}:x));
  }
  function toggleWidget(widgetId:string){
    markDirty();
    setViews(existing=>existing.map(x=>x.id===selected?{...x,definition:{...x.definition,widgets:x.definition.widgets.map(w=>w.id===widgetId?{...w,visible:!w.visible}:w)}}:x));
  }

  function renameWidget(widgetId:string,title:string){
    markDirty();
    setViews(existing=>existing.map(x=>x.id===selected?{...x,definition:{...x.definition,widgets:x.definition.widgets.map(w=>w.id===widgetId?{...w,title}:w)}}:x));
  }
  function moveWidget(widgetId:string,direction:-1|1){
    if(!view)return;
    const ordered=[...view.definition.widgets].sort((a,b)=>a.order-b.order);
    const index=ordered.findIndex(w=>w.id===widgetId);
    if(index<0||index+direction<0||index+direction>=ordered.length)return;
    markDirty();
    setViews(existing=>existing.map(x=>{
      if(x.id!==selected)return x;
      const widgets=[...x.definition.widgets].sort((a,b)=>a.order-b.order);
      const index=widgets.findIndex(w=>w.id===widgetId);
      const next=index+direction;
      if(index<0||next<0||next>=widgets.length)return x;
      [widgets[index],widgets[next]]=[widgets[next],widgets[index]];
      return {...x,definition:{...x.definition,widgets:widgets.map((w,order)=>({...w,order}))}};
    }));
  }

  if((selectedTemplate as string|null)==='SALES')return <SalesSetup workspaceId={workspaceId} onExit={()=>{setSelectedTemplate(null);const url=new URL(window.location.href);url.searchParams.delete('sales');window.history.replaceState(null,'',url);openSection('create');}}/>;
  return <main style={{maxWidth:1080,margin:"0 auto",padding:"32px 20px",fontFamily:"system-ui,sans-serif"}}>
    <header className="av-studio-header" style={{gap:16}}>
      <div><p style={{color:"#536376"}}>Averidi Dashboard</p><h1>Studio</h1><p>Upload your data, prepare a dashboard, or open saved results.</p></div>
      {!showSetup?<><p role="status" style={{flexBasis:"100%",order:3}}>{autosavePaused?"Autosave paused. Your edits are retained. Review the error, then retry Save changes or reload after a conflict.":saving?"Saving dashboard automatically…":view&&dirtyIds.includes(view.id)?"Changes will save automatically after you pause editing.":"Dashboard changes save automatically."}</p><button type="button" disabled={!view||view.canEdit===false||saving||loading||loadError||!dirtyIds.includes(view.id)} onClick={()=>void saveChanges()}>{saving?"Saving…":"Save changes"}</button></>:null}
    </header>
    <nav className="av-studio-tabs" aria-label="Studio actions" style={{display:'flex',gap:8,flexWrap:'wrap'}}>
      {([['data','Upload data'],['create','Create a dashboard'],['view','View dashboard']] as const).map(([section,label])=><button key={section} type="button" aria-pressed={studioSection===section} onClick={()=>openSection(section)} style={{padding:'11px 18px',borderRadius:9,border:'1px solid #174f76',background:studioSection===section?'#174f76':'#fff',color:studioSection===section?'#fff':'#174f76',fontWeight:700}}>{label}</button>)}
    </nav>
    {showSetup?<section className="av-studio-setup" aria-label={studioSection==='data'?'Upload and review data':'Dashboard setup'} style={{padding:20,border:'1px solid #d6e1eb',borderRadius:14,background:'#fafcff',marginTop:12}}><h2>{studioSection==='data'?'Upload your business data':'Create a dashboard'}</h2>
    <p>{studioSection==='data'?'Start with a CSV, Excel, or JSON file. Your saved dashboards stay available in View dashboard.':'Choose a dashboard type, select ready data below, then review and create your dashboard.'}</p>
    {(studioSection==='create'||studioSection==='data'&&!selectedTemplate)?<>
    <section aria-label="Choose dashboard type" style={{marginTop:24,padding:20,border:'1px solid #ccd4de',borderRadius:12}}>
      <h2>Choose the dashboard you want to create</h2>
      <p>You choose the dashboard type. We'll help you prepare the data it needs; your choice will not change automatically.</p>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:12}}>
        {DASHBOARD_TEMPLATES.map(template=><button key={template.key} type="button" aria-pressed={selectedTemplate===template.key} onClick={()=>{setSelectedTemplate(template.key);if(template.key==='SALES'){const url=new URL(window.location.href);url.searchParams.set('sales','1');window.history.replaceState(null,'',url);}}} style={{padding:16,textAlign:'left',border:selectedTemplate===template.key?'2px solid #174f76':'1px solid #ccd4de',borderRadius:10,background:selectedTemplate===template.key?'#eef5fc':'transparent',color:'inherit',cursor:'pointer'}}>
          <strong>{template.name}</strong><span style={{display:'block',marginTop:8}}>{template.description}</span>
        </button>)}
      </div>
      {selectedTemplate?<p role="status">Selected: {DASHBOARD_TEMPLATES.find(t=>t.key===selectedTemplate)?.name}. Add your data below to continue.</p>:<p>Choose the information you want to see. You can change this later.</p>}
    </section>
    </>:null}
    {studioSection==='create'&&selectedTemplate?<OnboardingGuide dataset={datasetForReview} analysis={onboardingAnalysis} views={views} loading={datasetsLoading||loading} error={!!datasetError||loadError} workspaceId={workspaceId}/>:null}
    {selectedTemplate?<>
    <section id="workspace-data" tabIndex={-1} aria-label="Workspace datasets" style={{margin:"20px 0",padding:16,border:"1px solid #ccd4de",borderRadius:10}}>
      <h2>Your business data</h2>
      {!canUpload?<p role="status">Your workspace role does not allow uploads. Ask a workspace owner or an editor with data access to upload this file.</p>:null}
      <form onSubmit={uploadData} style={{display:"grid",gap:10,margin:"16px 0",padding:12,border:"1px solid #ccd4de",borderRadius:8}}>
        <h3 style={{margin:0}}>Add your business data</h3>
        <fieldset disabled={!canUpload||uploadBusy||!!processingUpload} style={{border:0,padding:0,margin:0,minWidth:0,display:"grid",gap:10}}><legend style={{fontWeight:600}}>File and destination</legend>
        <label>Where to save your data
          <select value={uploadDatasetId} onChange={event=>{setUploadDatasetId(event.target.value);setUploadMode("REPLACE");setRecordIdentityField("");}} disabled={uploadBusy} style={{display:"block",width:"100%",padding:8}}>
            <option value="">Upload new business data</option>
            {datasets.filter(d=>d.status!=="ARCHIVED").map(d=><option key={d.id} value={d.id}>Update {d.name}</option>)}
          </select>
        </label>
        {!uploadDatasetId?<label>Name for this data
          <input required maxLength={120} value={uploadName} onChange={event=>setUploadName(event.target.value)} disabled={uploadBusy} placeholder="e.g. Monthly sales" style={{display:"block",width:"100%",padding:8}}/>
        </label>:null}
        <label>CSV, JSON or Excel (.xlsx) file
          <small>Accepted formats: CSV, JSON, and unencrypted XLSX. Default limits: 25 MiB, 50,000 rows, 100 columns.</small>
          <input required={!uploadFile} type="file" accept=".csv,.json,.xlsx" disabled={uploadBusy||previewBusy} onChange={event=>{setUploadFile(event.target.files?.[0]??null);setUploadWorksheet('');setCsvDelimiter("auto");setUploadWorksheets([]);setUploadPreview(null);setPreserveTextFields([]);setUploadStage("IDLE");setUploadMessage('');}} style={{display:"block",marginTop:6}}/>
        </label>
        {uploadFile?<p role="status">Selected file: <strong>{uploadFile.name}</strong>. Your file stays selected while you use Studio.</p>:null}
        {uploadFile?.name.toLowerCase().endsWith(".csv")?<label>CSV separator
          <select value={csvDelimiter} disabled={uploadBusy||previewBusy} onChange={event=>{setCsvDelimiter(event.target.value as "auto"|"comma"|"semicolon"|"tab");setUploadPreview(null);setPreserveTextFields([]);}} style={{display:"block",padding:8}}>
            <option value="auto">Detect automatically</option><option value="comma">Comma (,)</option><option value="semicolon">Semicolon (;)</option><option value="tab">Tab</option>
          </select>
        </label>:null}
        {uploadWorksheets.length>0?<label>Choose an Excel sheet
          <select value={uploadWorksheet} disabled={uploadBusy||previewBusy} onChange={event=>{setUploadWorksheet(event.target.value);setUploadPreview(null);setPreserveTextFields([]);}} style={{display:'block',width:'100%',padding:8}}>
            <option value="">Select a sheet</option>{uploadWorksheets.map(name=><option key={name} value={name}>{name}</option>)}
          </select>
        </label>:null}
        <details><summary>My Excel file contains multiple sheets</summary><label>Excel sheet name (optional)
          <input value={uploadWorksheet} maxLength={120} disabled={uploadBusy||previewBusy} onChange={event=>{setUploadWorksheet(event.target.value);setUploadPreview(null);setPreserveTextFields([]);}} placeholder="Optional" style={{display:"block",width:"100%",padding:8}}/>
        </label></details>
        <details><summary>Advanced: how to update existing data</summary><label>Import mode
          <select value={uploadMode} disabled={uploadBusy||!uploadDatasetId} onChange={event=>setUploadMode(event.target.value as "REPLACE"|"APPEND"|"SYNCHRONIZE")} style={{display:"block",padding:8,width:"100%"}}>
            <option value="REPLACE">Replace dataset after successful validation</option>
            {uploadDatasetId?<><option value="APPEND">Append new records (requires unique record ID)</option><option value="SYNCHRONIZE">Synchronize from a complete, authoritative snapshot</option></>:null}
          </select>
        </label>
        {uploadMode!=="REPLACE"&&uploadDatasetId?<label>Unique record identity field
          <input required maxLength={120} placeholder="e.g. order_id" value={recordIdentityField} disabled={uploadBusy} onChange={event=>setRecordIdentityField(event.target.value)} style={{display:"block",padding:8,width:"100%"}}/>
          <small>{uploadMode==="APPEND"?"Matching identical records are skipped; changed overlaps are rejected.":"The uploaded file must be the complete authoritative record set; records missing from it will be removed after verification."}</small>
        </label>:null}</details>
        <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
          <button type="button" onClick={previewUpload} disabled={!canUpload||!uploadFile||previewBusy||uploadBusy}>{previewBusy?"Checking…":"Recheck file"}</button>
          <button type="submit" disabled={!canUpload||uploadBusy||previewBusy||!uploadFile||!uploadPreview}>{uploadBusy?"Uploading…":processingUpload?"Processing data…":"Upload my data"}</button>
        </div>
        </fieldset>
        {uploadPreview?<section aria-label="File preview">
          <p><strong>{uploadPreview.rowCount}</strong> rows, <strong>{uploadPreview.columns.length}</strong> fields, <strong>{uploadPreview.duplicateCount}</strong> identical duplicate rows.</p>
          <p>Averidi detected your field types automatically. You can upload without reviewing individual columns.</p>
          <p role="status">{uploadPreview.columns.filter(column=>column.dataType==="TEXT").length} text, {uploadPreview.columns.filter(column=>column.dataType==="DATE").length} date, {uploadPreview.columns.filter(column=>column.dataType==="NUMBER").length} number, and {uploadPreview.columns.filter(column=>column.dataType==="BOOLEAN").length} boolean fields recognized.</p>
          <details><summary>Advanced: change how a field is interpreted</summary>
          <fieldset style={{display:"grid",gap:6,padding:10}}><legend>Keep selected fields as text</legend>
          {uploadPreview.columns.map(column=><label key={column.name} style={{display:"flex",alignItems:"center",gap:8}}>
            <input type="checkbox" checked={preserveTextFields.includes(column.name)} disabled={uploadBusy} onChange={event=>{setPreserveTextFields(previous=>event.target.checked?[...previous,column.name]:previous.filter(name=>name!==column.name));}}/>
            {column.name} — {column.dataType}
          </label>)}
          </fieldset></details>
          {uploadPreview.profile?.uncertainDateFields?.length?<p role="note">Date formats could not be determined confidently for: {uploadPreview.profile.uncertainDateFields.join(", ")}. Original values were preserved as text. Review the source format before calculating date-based metrics.</p>:null}
          {uploadPreview.profile?.fields&&Object.entries(uploadPreview.profile.fields).some(([,field])=>(field.missingRate??0)>0)?<p role="note">Some columns contain empty or missing values. Inspect the sample before confirming data fields.</p>:null}
          <div role="region" aria-label="File preview table" tabIndex={0} style={{overflowX:"auto"}}><table><thead><tr>{uploadPreview.columns.slice(0,10).map(column=><th key={column.name} style={{textAlign:"left",padding:6}}>{column.name} <small>({column.dataType})</small></th>)}</tr></thead>
          <tbody>{uploadPreview.preview.slice(0,5).map((row,i)=><tr key={i}>{uploadPreview.columns.slice(0,10).map(column=><td key={column.name} style={{padding:6}}>{previewCell(row[column.name],column.dataType)}</td>)}</tr>)}</tbody></table></div>
          <small>Preview only; no dataset data has been saved yet.</small>
        </section>:null}
        {uploadStage==="TRANSFERRING"&&uploadPercent!==null?<div aria-label="File upload progress"><progress value={uploadPercent} max={100} style={{width:"100%"}}/>{uploadPercent}% uploaded</div>:null}
        {processingUpload?<p role="status">File received. Checking dataset processing status…</p>:null}
        {uploadStage!=="IDLE"?<p role="status" aria-live="polite">Upload status: {uploadStage==="REGISTERING"?"Preparing dataset":uploadStage==="TRANSFERRING"?"Sending file":uploadStage==="QUEUED"?"Received; background processing queued":"Upload failed; your file remains selected for retry"}</p>:null}
        {uploadMessage?<p role="status">{uploadMessage}</p>:null}
      </form>
      <details style={{padding:12,border:"1px solid #ccd4de",borderRadius:8,margin:"12px 0"}}>
        <summary>Advanced: previous uploads and restoring data</summary>
        <p>Only successfully profiled versions can be restored. Pending uploads are not active.</p>
        <label>Dataset
          <select value={historyDatasetId} onChange={event=>{setHistoryDatasetId(event.target.value);setHistoryMessage("");}} style={{display:"block",padding:8,maxWidth:"100%"}}>
            {datasets.map(dataset=><option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}
          </select>
        </label>
        {versionHistory.length>0?<div role="region" aria-label="Dataset version history" tabIndex={0} style={{overflowX:"auto",marginTop:12}}><table><thead><tr><th scope="col">Version</th><th scope="col">Status</th><th scope="col">Import</th><th scope="col">Rows</th><th scope="col">Date</th></tr></thead>
          <tbody>{versionHistory.map(version=><tr key={version.id}>
            <td>{version.version}{activeHistoryVersionId===version.id?" (active)":""}</td>
            <td>{version.status}</td><td>{version.importMode}</td><td>{version.rowCount??"Pending"}</td><td>{new Date(version.createdAt).toLocaleDateString(presentation?.locale??'en-US',presentation?{timeZone:presentation.timezone}:undefined)}</td>
          </tr>)}</tbody></table></div>:<p>No versions recorded yet.</p>}
        {versionHistory.some(version=>version.status==="READY")?<div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginTop:12}}>
          <label>Verified version
            <select value={rollbackTarget} onChange={event=>setRollbackTarget(event.target.value)} disabled={rollbackBusy}>
              {versionHistory.filter(version=>version.status==="READY").map(version=><option key={version.id} value={version.id}>Version {version.version}{version.id===activeHistoryVersionId?" (active)":""}</option>)}
            </select>
          </label>
          <button type="button" onClick={restoreVersion} disabled={!canUpload||rollbackBusy||!rollbackTarget||rollbackTarget===activeHistoryVersionId}>{rollbackBusy?"Restoring…":"Restore version"}</button>
        </div>:null}
        {historyMessage?<p role="status">{historyMessage}</p>:null}
      </details>
      <p>We check your data before using it to create a dashboard.</p>
      {datasetsLoading?<p role="status">Loading datasets…</p>:null}
      {datasetError?<div role="alert"><p>{datasetError} Previously loaded datasets have not been deleted.</p><button type="button" onClick={()=>setDatasetPoll(value=>value+1)} disabled={datasetsLoading}>Retry loading datasets</button></div>:null}
      {!datasetsLoading&&!datasetError&&datasets.some(dataset=>dataset.status==="READY")?<label>Dataset for a new dashboard
        <select aria-label="Dataset for a new dashboard" value={selectedDataset} onChange={event=>{setSelectedDataset(event.target.value);setFieldChoices({});setConfirmationMessage("");setRuleChoices({});setRulesMessage("");}} style={{display:"block",padding:10,margin:"8px 0 16px",maxWidth:"100%"}}>
          {datasets.filter(dataset=>dataset.status==="READY").map(dataset=><option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}
        </select>
      </label>:null}
      {!datasetsLoading&&!datasetError&&datasets.length>0&&!datasets.some(dataset=>dataset.status==="READY")?<p>No validated datasets are ready for dashboard creation.</p>:null}
      {!datasetsLoading&&!datasetError&&datasets.length===0?<p>You have not uploaded any business data yet.</p>:null}
      {datasetForReview?.latestVersionId?<details id="business-rules" tabIndex={-1} style={{marginTop:16}}>
        <summary>Review calculation details</summary>
        <p>Confirm the essentials below so your Sales totals are trustworthy. Other calculations can be configured later if needed.</p>
        {datasetForReview?.grainSuggestion?<section aria-label="Suggested row meaning"><h3>Suggested row meaning: {datasetForReview.grainSuggestion.kind.replaceAll("_"," ")}</h3><p>Advisory only. Review {datasetForReview.grainSuggestion.rowCount} rows; confirm the actual meaning below. Saved business rules are not changed by this suggestion.</p><ul>{datasetForReview.grainSuggestion.evidence.map((e,i)=><li key={i}>{e}</li>)}</ul></section>:<p>Row meaning has not been assessed for this version. Review and confirm it below.</p>}
        <h3>Essential details</h3><p>We only ask for information that cannot be safely assumed from your file. If you're unsure, select Unknown where available; unsupported calculations will remain unavailable.</p>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:12}}>{ruleFields.filter(field=>essentialRuleKeys.has(field.key)).map(field=><label key={field.key}>{field.label}<select aria-label={field.label} value={ruleChoices[field.key]??savedRuleValue(field.key)} disabled={!canAnalyze||savingRules} onChange={event=>setRuleChoices(values=>({...values,[field.key]:event.target.value}))} style={{display:"block",width:"100%",padding:8,marginTop:4}}><option value="">Select</option>{field.choices.map(choice=><option value={choice} key={choice}>{choice==="unknown"?"Unknown":choice.replaceAll("_"," ")}</option>)}</select></label>)}</div>
        {(ruleChoices.currencyMode??savedRuleValue("currencyMode"))==="SINGLE"?<label style={{display:"block",marginTop:12}}>Three-letter currency code<input maxLength={3} placeholder="USD" value={ruleChoices.currency??String(datasetForReview.metricRules?.currency??presentation?.currency??"")} disabled={!canAnalyze||savingRules} onChange={event=>setRuleChoices(values=>({...values,currency:event.target.value}))} style={{display:"block",padding:8}}/></label>:null}
        <label style={{display:'block',marginTop:12}}>Business timezone (required for dates)<input disabled={!canAnalyze||savingRules} placeholder="America/New_York" value={ruleChoices.timezone??String(datasetForReview.metricRules?.timezone??presentation?.timezone??'')} onChange={event=>setRuleChoices(v=>({...v,timezone:event.target.value}))}/></label>
        <details style={{marginTop:16}}><summary>Additional settings for advanced calculations (optional)</summary><p>These are only needed for additional metrics. Leave them unchanged unless you know the correct answers.</p>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:12}}>{optionalRuleFields.map(field=><label key={field.key}>{field.label}<select aria-label={field.label} value={ruleChoices[field.key]??savedRuleValue(field.key)} disabled={!canAnalyze||savingRules} onChange={event=>setRuleChoices(values=>({...values,[field.key]:event.target.value}))} style={{display:"block",width:"100%",padding:8,marginTop:4}}><option value="">Select</option>{field.choices.map(choice=><option value={choice} key={choice}>{choice==="unknown"?"Unknown":choice.replaceAll("_"," ")}</option>)}</select></label>)}</div>
        {selectedTemplate==="SALES"?<>
        <fieldset style={{marginTop:12,border:"1px solid #ccd4de",padding:12}}><legend>Sales planning inputs (exact selected reporting period; never inferred from sales rows)</legend>
          {([["salesPlanningPeriodStart","Planning start (YYYY-MM-DD)","text"],["salesPlanningPeriodEnd","Planning end (YYYY-MM-DD)","text"],["salesTargetAmount","Revenue target","number"],["salesBudgetAmount","Revenue budget","number"],["salesEligibleSellingDays","Eligible selling days","number"]] as const).map(([key,label,type])=><label key={key} style={{display:"block",marginTop:8}}>{label}<input type={type} min={type==="number"?0:undefined} step={key==="salesEligibleSellingDays"?1:"any"} value={ruleChoices[key]??savedRuleValue(key)} disabled={!canAnalyze||savingRules} onChange={event=>setRuleChoices(values=>({...values,[key]:event.target.value}))} style={{display:"block",maxWidth:240,width:"100%",padding:8}}/></label>)}
        </fieldset>
        <fieldset style={{marginTop:12,border:"1px solid #ccd4de",padding:12}}><legend>Sales forecast and acquisition cohort settings</legend>{([["salesForecastSeasonDays","Forecast seasonal cycle in days","number"],["salesForecastHorizonDays","Forecast horizon in days","number"],["salesCohortMonth","First-purchase cohort (YYYY-MM)","text"]] as const).map(([key,label,type])=><label key={key} style={{display:"block",marginTop:8}}>{label}<input type={type} min={type==="number"?1:undefined} step={type==="number"?1:undefined} value={ruleChoices[key]??savedRuleValue(key)} disabled={!canAnalyze||savingRules} onChange={event=>setRuleChoices(values=>({...values,[key]:event.target.value}))} style={{display:"block",maxWidth:240,width:"100%",padding:8}}/></label>)}</fieldset>
        <label style={{display:"block",marginTop:12}}>Top-N sales concentration count (1–100)<input type="number" min={1} max={100} step={1} value={ruleChoices.salesTopN??savedRuleValue("salesTopN")} disabled={!canAnalyze||savingRules} onChange={event=>setRuleChoices(values=>({...values,salesTopN:event.target.value}))} style={{display:"block",maxWidth:240,width:"100%",padding:8}}/></label>
        </>:null}
        {selectedTemplate==="INVENTORY"?<fieldset style={{marginTop:12,border:"1px solid #ccd4de",padding:12}}>
          <legend>Inventory replenishment assumptions (enter known values only; use zero safety days when none are required)</legend>
          {([
            ["inventoryDemandPeriodDays","Demand observation period (days)",1,366],
            ["inventoryLeadTimeDays","Replenishment lead time (days)",0.01,365],
            ["inventorySafetyDays","Safety coverage (days; enter 0 for none)",0,365],
          ] as const).map(([key,label,min,max])=><label key={key} style={{display:"block",marginTop:8}}>{label}
            <input type="number" min={min} max={max} step={key==="inventoryDemandPeriodDays"?"1":"any"}
              value={ruleChoices[key]??String(datasetForReview.metricRules?.[key]??"")}
              disabled={!canAnalyze||savingRules} onChange={event=>setRuleChoices(values=>({...values,[key]:event.target.value}))}
              style={{display:"block",maxWidth:240,width:"100%",padding:8}}/>
          </label>)}
        </fieldset>:null}
        <UnitRulesEditor disabled={!canAnalyze||savingRules} fields={datasetForReview?.confirmedMappings??[]} value={unitChoices??(datasetForReview?.metricRules?.units as UnitRules)??{}} onChange={setUnitChoices}/></details><button type="button" disabled={!canAnalyze||savingRules} onClick={saveMetricRules} style={{marginTop:12}}>{savingRules?"Saving rules…":"Save calculation choices"}</button>
        {rulesMessage?<p role="status">{rulesMessage}</p>:null}
      </details>:null}
      {datasets.length>0?<ul>{datasets.map(dataset=><li key={dataset.id}>{dataset.name} — {dataset.status==="FAILED"?"Validation failed":dataset.status!=="READY"?"Not ready":dataset.analysisStatus==="READY"?"Metrics calculated":dataset.analysisStatus==="BLOCKED"?"Data quality requires attention":"Data checked; review the column meanings and calculation choices"}</li>)}</ul>:null}
      {selectedDataset&&datasets.find(dataset=>dataset.id===selectedDataset)?.suggestedMappings?.length?<details id="field-meanings" tabIndex={-1} style={{marginTop:16}}>
        <summary>Review column meanings</summary>
        <p>Averidi automatically saves clearly recognized identifiers, dates, and quantities for newly processed files. Other suggestions are optional until needed for a calculation. Change only fields that need correction; saving an override does not establish currency, accounting treatment, or row grain.</p>
        <ul style={{listStyle:"none",padding:0}}>{datasetForReview?.suggestedMappings.map((mapping,index)=><li key={`${mapping.sourceField}-${index}`} style={{marginBottom:12}}><label><strong>{mapping.sourceField}</strong> — Suggested: {mapping.proposedConcept}<select aria-label={`Meaning of ${mapping.sourceField}`} value={fieldChoices[mapping.sourceField]??datasetForReview.confirmedMappings.find(item=>item.sourceField===mapping.sourceField)?.canonicalConcept??(fieldConcepts.includes(mapping.proposedConcept as typeof fieldConcepts[number])?mapping.proposedConcept:"")} disabled={!canAnalyze||confirmingFields} onChange={event=>setFieldChoices(current=>({...current,[mapping.sourceField]:event.target.value}))} style={{display:"block",padding:8,marginTop:4}}><option value="">Choose a meaning</option>{fieldConcepts.map(concept=><option key={concept} value={concept}>{concept==="IGNORE"?"Do not use for business metrics":concept}</option>)}</select></label></li>)}</ul>
        <button type="button" disabled={!canAnalyze||confirmingFields||!datasetForReview?.latestVersionId} onClick={saveFieldConfirmations}>{confirmingFields?"Saving field choices…":"Save confirmed field meanings"}</button>
        {confirmationMessage?<p role="status">{confirmationMessage}</p>:null}
      </details>:null}
      {datasetForReview?.latestVersionId?<DatasetAnalysis preferredTemplate={studioSection==='create'?selectedTemplate:null} onChooseTemplate={()=>openSection('create')} onProgress={updateOnboarding} key={datasetForReview.id+datasetForReview.latestVersionId} workspaceId={workspaceId} datasetId={datasetForReview.id} versionId={datasetForReview.latestVersionId} reloadKey={reloadKey} onCreated={id=>{setDashboardReadyMessage("");setNewDashboardId(id);setSelected(id);openSection('view');setReloadKey(k=>k+1);}}/>:null}
    </section>
    </>:<p role="status">Choose a dashboard type above so we can prepare your file correctly.</p>}
    </section>:null}
    {!showSetup&&loading?<section className="av-card" role="status" aria-live="polite"><h2>Opening your dashboard</h2><p>We’re loading its saved metrics and layout.</p></section>:null}
    {!showSetup&&dashboardReadyMessage&&!loading&&!loadError?<p role="status" aria-live="polite" style={{padding:12,background:"#eaf5f0",borderRadius:10}}>{dashboardReadyMessage}</p>:null}
    {message?<div role="status" aria-live="polite"><p>{message}</p><button type="button" disabled={saving} onClick={reloadDashboards}>Reload dashboards</button></div>:null}
    {view&&dirtyIds.includes(view.id)?<p role="status">Unsaved changes to this dashboard.</p>:null}
    {!loading&&!loadError&&views.length===0&&!showSetup?<section className="av-card"><h2>No dashboards yet</h2><p>Create your first dashboard to see your business results here.</p><button type="button" onClick={()=>openSection('create')}>Create my first dashboard</button></section>:null}
    {!showSetup&&views.length>0?<label>Dashboard
      <select value={selected??""} disabled={saving||loading||loadError} onChange={e=>selectDashboard(e.target.value)} style={{display:"block",padding:10,margin:"8px 0 20px"}}>
        {views.map(x=><option value={x.id} key={x.id}>{x.name}</option>)}
      </select>
    </label>:null}
    {!showSetup&&view&&!loadError?<section id="finished-dashboard" tabIndex={-1} aria-label="Your finished dashboard"><div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}><h2>{view.definition.name}</h2><a href={'/dashboard/app/workspaces/'+encodeURIComponent(workspaceId)+'/views/'+encodeURIComponent(view.id)} style={{fontWeight:700,color:'#1675ef'}}>Open finished dashboard</a></div><DashboardCanvas readOnly={view.canEdit===false} layoutResetKey={layoutResetKey} onLayoutDirtyChange={updateLayoutDirty} key={view.id} workspaceId={workspaceId} viewId={view.id} updatedAt={view.updatedAt} reloadKey={reloadKey} sourceVersionId={datasets.find(d=>d.id===view.datasetId)?.latestVersionId??null} definition={view.definition} hasUnsavedChanges={dirtyIds.includes(view.id)} onRefreshed={()=>setReloadKey(k=>k+1)} onDefinitionChange={definition=>{markDirty();setViews(rows=>rows.map(row=>row.id===view.id?{...row,definition}:row));}}/></section>:null}
    {!showSetup&&view&&!loadError&&view.definition.template!=="SALES"?<details aria-label="Dashboard customization" style={{marginTop:22,padding:16,border:"1px solid var(--av-border,#ccd9e5)",borderRadius:12,background:"#fff"}}><summary style={{cursor:"pointer",fontWeight:700}}>Advanced settings — customize dashboard</summary><section aria-label="Dashboard editor" style={{marginTop:18}}>
      <label>Dashboard name
        <input value={view.definition.name} maxLength={120} disabled={saving||layoutDirty||view.canEdit===false} onChange={e=>updateName(e.target.value)} style={{display:"block",padding:10,minWidth:280,margin:"8px 0 24px"}}/>
      </label>
      <h2>Widgets</h2>
      <p>Rename, show, hide and reorder widgets, then save your changes.</p>
      <ul style={{padding:0,listStyle:"none",display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:12}}>
        {[...view.definition.widgets].sort((a,b)=>a.order-b.order).map(widget=><li key={widget.id} style={{border:"1px solid #ccd4de",borderRadius:10,padding:18}}>
          <label>Widget title <input style={{display:"block",width:"100%",margin:"8px 0"}} maxLength={80} disabled={saving||layoutDirty||view.canEdit===false} value={widget.title} onChange={e=>renameWidget(widget.id,e.target.value)}/></label><p>{widget.metricKey} · {widget.kind}</p>
          <label><input type="checkbox" checked={widget.visible} disabled={saving||layoutDirty||view.canEdit===false} onChange={()=>toggleWidget(widget.id)}/> Visible</label>
          <div style={{display:"flex",gap:8,marginTop:12}}><button type="button" aria-label={`Move ${widget.title} up`} disabled={saving||layoutDirty||view.canEdit===false||widget.order===0} onClick={()=>moveWidget(widget.id,-1)}>Up</button><button type="button" aria-label={`Move ${widget.title} down`} disabled={saving||layoutDirty||view.canEdit===false||widget.order===view.definition.widgets.length-1} onClick={()=>moveWidget(widget.id,1)}>Down</button></div>
        </li>)}
      </ul>
    </section></details>:null}
  </main>;
}


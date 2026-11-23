'use client';
import {dashboardAuthenticatedFetch} from '../../lib/dashboard-authenticated-fetch';
import SourceQualitySummary from '../data/SourceQualitySummary';
import type {SourceQualityAssessment} from '../../features/data-model/source-quality';
import {useWorkspacePresentation,formatWorkspaceDate} from '../workspace/WorkspacePresentation';
import {useWorkspacePermission} from '../workspace/WorkspacePermissions';
import {useEffect,useRef,useState} from 'react';
import {recommendDashboardTemplates,type DashboardTemplateKey} from '../../engines/generation/dashboard-templates';
import type {DashboardAnalysis} from '../../engines/analysis/pipeline';
import type {OnboardingAnalysis} from '../../features/onboarding/progress';
type Run=DashboardAnalysis&{id:string;versionId:string;createdAt:string;status:string};
export default function DatasetAnalysis({workspaceId,datasetId,versionId,reloadKey,onCreated,onProgress,preferredTemplate,onChooseTemplate}:{workspaceId:string;datasetId:string;versionId:string;reloadKey:number;onCreated:(id:string)=>void;onProgress?:(analysis:OnboardingAnalysis)=>void;preferredTemplate?:DashboardTemplateKey|null;onChooseTemplate?:()=>void}){
 const presentation=useWorkspacePresentation();
 const canCalculate=useWorkspacePermission('analysis.manage'),canCreate=useWorkspacePermission('views.manage');
 const api=`/dashboard/app/api/workspaces/${encodeURIComponent(workspaceId)}`;
 const deliveredView=useRef<string|null>(null),requestedCreationJob=useRef<string|null>(null);
 const [qualityAssessment,setQualityAssessment]=useState<SourceQualityAssessment>();
 const [run,setRun]=useState<Run|null>(null),[job,setJob]=useState<{id:string;status:string;progress:number;result?:{viewId?:string;templateUnavailable?:boolean};payload?:{template?:DashboardTemplateKey}}|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[refresh,setRefresh]=useState(0);
 useEffect(()=>{
  let active=true,timer:ReturnType<typeof setTimeout>;
  setRun(null);setJob(null);setQualityAssessment(undefined);
  async function load(){try{
   const response=await dashboardAuthenticatedFetch(`${api}/datasets/${encodeURIComponent(datasetId)}/analysis`,{cache:'no-store'});const body=await response.json();if(!response.ok)throw Error(body.error==='UNAUTHORIZED'?'Your session expired. Retry this action or sign in again.':body.error??'Unable to complete this action.');
   if(active){setRun(body.analysis);setJob(body.job);setQualityAssessment(body.qualityAssessment);if(['QUEUED','RUNNING'].includes(body.job?.status))timer=setTimeout(load,2000);else if(body.job?.status==='COMPLETED'&&body.job.id===requestedCreationJob.current&&body.job.result?.viewId&&deliveredView.current!==body.job.result.viewId){deliveredView.current=body.job.result.viewId;setMessage('Dashboard created.');onCreated(body.job.result.viewId);}else if(body.job?.status==='COMPLETED'&&body.job.result?.templateUnavailable){setMessage('Analysis completed, but the selected dashboard template requires metrics that are not available. Review the missing metrics below, correct the confirmed fields or rules, and analyze again.');}else if(['FAILED','CANCELLED'].includes(body.job?.status)){setMessage('Analysis did not finish successfully. Review the job status and try again.');}}
  }catch(error){if(active)setMessage(error instanceof Error?error.message:'Unable to load calculation.');}}
  load();return()=>{active=false;clearTimeout(timer);};
 },[api,datasetId,versionId,reloadKey,refresh]);
 useEffect(()=>{onProgress?.(run?{datasetId,versionId:run.versionId,id:run.id,status:run.status,qualityPass:run.quality.status==='PASS',readyMetrics:run.outcomes.some(m=>m.status==='READY')}:null);},[run,datasetId,onProgress]);
 async function calculate(createAfter=false){if(!canCalculate||busy)return;if(createAfter&&(!preferredTemplate||!canCreate)){setMessage('Choose a dashboard type and ensure you have permission to create it.');return;}setBusy(true);setMessage('');try{
  const response=await dashboardAuthenticatedFetch(`${api}/datasets/${encodeURIComponent(datasetId)}/analysis`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({versionId,...(createAfter?{template:preferredTemplate}:{})})});const body=await response.json();if(!response.ok)throw Error(body.error==='CONFIRMATION_REQUIRED'?'Some field meanings or calculation details still need confirmation. Review the highlighted setup sections.':body.error==='UNAUTHORIZED'?'Your session expired. Retry this action or sign in again.':body.error??'Unable to complete this action.');

  requestedCreationJob.current=createAfter?body.jobId:null;
  setMessage(createAfter?'Preparing your dashboard. We’ll check your data before showing results.':'Checking your data. Your results will appear here shortly.');setRefresh(v=>v+1);
 }catch(error){setMessage(error instanceof Error?error.message:'Calculation failed.');}finally{setBusy(false);}}
 async function create(template:string){if(!run||!canCreate||busy)return;setBusy(true);setMessage('');try{
  const response=await dashboardAuthenticatedFetch(`${api}/views/generate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({datasetId,analysisId:run.id,template})});const body=await response.json();if(!response.ok)throw Error(body.error==='UNAUTHORIZED'?'Your session expired. Retry this action or sign in again.':body.error??'Unable to complete this action.');
  setMessage('Dashboard created.');onCreated(body.view.id);
 }catch(error){setMessage(error instanceof Error?error.message:'Unable to create dashboard.');}finally{setBusy(false);}}
 return <section id="calculate-metrics" tabIndex={-1} aria-label="Calculate and generate dashboard" style={{marginTop:20}}>
  <h3>Prepare your dashboard</h3><p>We’ll check your data, calculate what it supports, and explain anything that needs your attention.</p>
  <button type="button" disabled={!canCalculate||busy||['QUEUED','RUNNING'].includes(job?.status??'')} onClick={()=>calculate(false)}>{busy?'Working…':'Check my data'}</button>
  {preferredTemplate&&canCreate?<button type="button" disabled={!canCalculate||busy||['QUEUED','RUNNING'].includes(job?.status??'')} onClick={()=>calculate(true)} style={{marginLeft:8}}>Create my dashboard</button>:null}
  {job?<p role="status">{job.status==='QUEUED'?'Waiting to check your data':job.status==='RUNNING'?'Preparing your dashboard':job.status==='COMPLETED'?'Data check complete':'Data check needs attention'} ({job.progress}%)</p>:null}
  {message?<p role="status">{message}</p>:null}
  <SourceQualitySummary assessment={qualityAssessment} label="Selected dataset source quality"/>
  {run?<><p>Calculated {formatWorkspaceDate(run.createdAt,presentation)} · {run.quality.sourceRows} source rows · data check {run.quality.status.toLowerCase()}</p>
   {run.quality.issues.map(issue=><p role="alert" key={issue.code}>{issue.message}</p>)}
   <div role="region" aria-label="Metric results table" tabIndex={0} style={{overflowX:'auto'}}><table><thead><tr><th scope="col">Metric</th><th scope="col">Result</th><th scope="col">Explanation</th></tr></thead><tbody>{run.outcomes.map(m=><tr key={m.key}><th scope="row">{m.definition.label}</th><td>{m.status==='READY'?new Intl.NumberFormat(presentation?.locale??'en-US',{maximumFractionDigits:4}).format(m.value!)+(m.lineage.unit?' '+m.lineage.unit:''):'Unavailable'}</td><td>{m.reason??m.definition.formula}</td></tr>)}</tbody></table></div>
   <h3>Build your selected dashboard</h3>
   {!preferredTemplate?<><p>Your data can be used to create a dashboard. Choose the type you want to build.</p>{canCreate&&onChooseTemplate?<button type="button" onClick={onChooseTemplate}>Choose dashboard type</button>:null}</>:null}
   {recommendDashboardTemplates(run.outcomes).filter(t=>t.key===preferredTemplate).map(t=><div key={t.key} style={{padding:16,border:'1px solid #ccd4de',borderRadius:8}}><strong>{t.name}</strong><p>{t.description}</p><button type="button" disabled={!canCreate||busy||!t.available} onClick={()=>create(t.key)}>Create {t.name.toLowerCase()}</button>{!t.available?<p role="status">Your {t.name.toLowerCase()} choice is saved. {t.missing.length?`Required metrics not yet available: ${t.missing.join(', ')}. `:''}{t.reason??'Review and confirm the fields and business rules, then recalculate.'} You can add or correct the data above and calculate again; your dashboard choice will not change.</p>:null}</div>)}
  </>:null}
 </section>;
}

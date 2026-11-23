import {heartbeatSettings,sendHeartbeat} from './monitoring/heartbeat.mjs';
import {monitoringConfig,advanceState,acknowledgeState,deliverAlert} from './monitoring/policy.mjs';
import {stateDirectory,acquireMonitorLock,loadMonitorState,saveMonitorState} from './monitoring/state.mjs';
import {collectSamples,collectInfrastructureMetrics} from './monitoring/probes.mjs';
let unlock;
try{
 const heartbeat=heartbeatSettings(),config=monitoringConfig(process.env),directory=await stateDirectory(process.env.DASHBOARD_MONITOR_STATE_DIRECTORY);
 unlock=await acquireMonitorLock(directory);
 let state=await loadMonitorState(directory);const signals=await collectSamples(config);
 state=advanceState(state,signals,config);await saveMonitorState(directory,state);
 let delivered=true;
 try{await sendHeartbeat(heartbeat);}catch{delivered=false;}
 if(state.pending){try{await deliverAlert(state.pending,config);state=acknowledgeState(state);await saveMonitorState(directory,state);}catch{delivered=false;}}
 console.log(JSON.stringify({product:'averidi-dashboard',checkedAt:new Date().toISOString(),signals,infrastructure:await collectInfrastructureMetrics().catch(()=>null),alertDelivery:delivered?'ACKNOWLEDGED_OR_NONE':'PENDING',active: Object.entries(state.signals).filter(([,v])=>v.active).map(([name])=>name)}));
 if(!delivered||Object.values(signals).some(v=>!v))process.exitCode=1;
}catch{console.error(JSON.stringify({product:'averidi-dashboard',error:'MONITOR_EXECUTION_FAILED'}));process.exitCode=1;}
finally{if(unlock)await unlock();}

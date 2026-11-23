export function dashboardWorkerSettings(env:Partial<NodeJS.ProcessEnv>=process.env){
 const poll=Number(env.DASHBOARD_WORKER_POLL_MS??1000),timeout=Number(env.DASHBOARD_WORKER_JOB_TIMEOUT_MS??600000);
 if(!Number.isInteger(poll)||poll<100||poll>60000)throw Error('Invalid Dashboard worker polling interval.');
 if(!Number.isInteger(timeout)||timeout<1000||timeout>1800000)throw Error('Invalid Dashboard worker job timeout.');
 if(env.DASHBOARD_WORKER_ENABLED!=='true')throw Error('Dashboard worker is disabled.');
 return {poll,timeout};
}

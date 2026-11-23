/** Official Next instrumentation hook. No external tracing exporter or payload collection. */
export async function register(){
 if(process.env.NEXT_RUNTIME==='nodejs'){
  const {registerOTel}=await import('@vercel/otel');
  const {requestSpanProcessor}=await import('./features/observability/metrics');
  registerOTel({serviceName:'averidi-dashboard',instrumentations:[],propagators:['none'],traceSampler:'always_on',spanProcessors:[requestSpanProcessor()],resourceDetectors:[]});
 }
}

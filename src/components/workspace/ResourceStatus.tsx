'use client';
export default function ResourceStatus({loading,error,reload}:{loading:boolean;error:string;reload:()=>void}){
 return <>{loading?<p role="status">Loading…</p>:null}{error?<div role="alert"><p>{error}</p><a href="/dashboard/app/api/auth/login">Sign in</a>{' '}<button type="button" onClick={reload}>Try again</button></div>:null}</>;
}

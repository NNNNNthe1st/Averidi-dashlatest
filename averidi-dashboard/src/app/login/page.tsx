"use client";
import Link from 'next/link';
import {useEffect,useState} from 'react';
export default function Login(){
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[needsVerification,setNeedsVerification]=useState(false);
 useEffect(()=>{try{setEmail(sessionStorage.getItem('averidi-pending-email')??'');}catch{}},[]);
 async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);setMessage('');setNeedsVerification(false);try{
  const response=await fetch('/dashboard/app/api/auth/password-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});const data=await response.json();
  if(response.ok){try{sessionStorage.removeItem('averidi-pending-email');}catch{}window.location.assign('/dashboard/app/workspaces');return;}
  setNeedsVerification(data.error==='ACCOUNT_NOT_VERIFIED');setMessage(data.error==='ACCOUNT_NOT_VERIFIED'?'Verify your email before signing in. You can request another verification link below.':data.error==='RATE_LIMITED'?'Too many attempts. Wait 15 minutes before trying again.':response.status>=500?'Sign-in is temporarily unavailable. Your details have been retained; try again.':'The email or password was not accepted. Try again or reset your password.');
 }catch{setMessage('We could not connect. Your details have been retained; try again.');}finally{setBusy(false);}}
 async function resend(){setBusy(true);try{const r=await fetch('/dashboard/app/api/auth/resend-verification',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});setMessage(r.ok?'If verification is pending, a new link has been sent. Check your inbox and spam folder.':'We could not send a verification link. Try again later.');}catch{setMessage('We could not connect. Try again.');}finally{setBusy(false);}}
 return <main className="av-auth"><section className="av-card"><h1>Sign in to Averidi Dashboard</h1><form className="av-form" onSubmit={submit}><label>Email<input required type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Password<input required type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label><button disabled={busy}>{busy?'Please wait…':'Sign in'}</button></form>{message?<p role="alert">{message}</p>:null}{needsVerification?<button disabled={busy||!email} onClick={resend}>Resend verification email</button>:null}<p><Link href="/forgot-password">Forgot password?</Link> · <Link href="/signup">Create account</Link></p></section></main>;
}

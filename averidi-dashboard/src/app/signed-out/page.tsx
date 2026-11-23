export default function DashboardSignedOut(){
 return <main style={{maxWidth:720,margin:'60px auto',padding:24,fontFamily:'system-ui,sans-serif'}}>
  <h1>You are signed out</h1>
  <p>Your Dashboard session has ended.</p>
  <a href="/dashboard/app/api/auth/login">Sign in to Dashboard</a>
 </main>;
}

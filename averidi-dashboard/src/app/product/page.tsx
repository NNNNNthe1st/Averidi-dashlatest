export const dynamic='force-dynamic';
import {publicDashboardPlans} from '../../features/billing/public-plans';
import type {Metadata} from 'next';
import Link from 'next/link';

export const metadata:Metadata={
 title:'Averidi Dashboard | Understand your business at a glance',
 description:'Turn your business data into clear, reliable dashboards. Explore a sample, then start a one-month Averidi Dashboard trial.',
 robots:{index:false,follow:false},
};

const features=[
 {title:'See what matters',detail:'Bring your key business metrics and visualizations together in a dashboard you can revisit.'},
 {title:'Work with your own data',detail:'Upload CSV, JSON or Excel files. Review suggested field meanings before any business calculation is treated as confirmed.'},
 {title:'Understand the numbers',detail:'See how metrics are calculated, what data supports them and where more information is needed.'},
 {title:'Build for your business',detail:'Choose a dashboard type and create a view using the metrics your data can support.'},
];
const steps=[
 {title:'Create your account',detail:'Sign in securely and tell us the name of your business.'},
 {title:'Choose a dashboard',detail:'Pick the type of business overview you want to build.'},
 {title:'Add and review your data',detail:'Upload a file, check field meanings and confirm calculation details.'},
 {title:'Analyze and build',detail:'Calculate supported metrics and create a dashboard from the validated results.'},
];
const trial='/signup';
const demo='/demo';
const button={display:'inline-flex',alignItems:'center',justifyContent:'center',padding:'14px 22px',borderRadius:10,fontWeight:700,textDecoration:'none'} as const;
export default async function DashboardProductPage(){
 const offer=await publicDashboardPlans();
 return <main style={{background:'#f7f9fc',color:'#172d45',lineHeight:1.6,minHeight:'100vh'}}>
  <header style={{background:'#fff',borderBottom:'1px solid #e0e7ee'}}>
   <nav aria-label="Product navigation" style={{maxWidth:1160,margin:'auto',padding:'16px 24px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,flexWrap:'wrap'}}>
    <Link href="/product" style={{color:'#174f76',fontWeight:800,textDecoration:'none',fontSize:20}}>AVERIDI <span style={{fontWeight:500}}>DASHBOARD</span></Link>
    <div style={{display:'flex',alignItems:'center',gap:18,flexWrap:'wrap'}}><a href="#features" style={{color:'inherit'}}>Features</a><a href="#how-it-works" style={{color:'inherit'}}>How it works</a><a href="#trial" style={{color:'inherit'}}>Free trial</a><Link href="/login" style={{color:'#174f76',fontWeight:700}}>Sign in</Link></div>
   </nav>
  </header>
  <section style={{background:'linear-gradient(135deg,#102c48 0%,#174f76 65%,#286b89 100%)',color:'#fff'}}>
   <div style={{maxWidth:1160,margin:'auto',padding:'clamp(48px,8vw,104px) 24px',display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,340px),1fr))',gap:48,alignItems:'center'}}>
    <div>
     <p style={{letterSpacing:2,fontWeight:700,fontSize:13}}>BUSINESS ANALYTICS, MADE CLEAR</p>
     <h1 style={{fontSize:'clamp(36px,5vw,60px)',lineHeight:1.12,letterSpacing:'-0.035em',margin:'16px 0 24px'}}>Know your business. Make your next decision with confidence.</h1>
     <p style={{fontSize:19,color:'#e2edf5',maxWidth:610}}>Averidi Dashboard turns your business data into useful metrics and clear visualizations—so you can spot changes, understand performance and stay focused on what matters.</p>
     <div style={{display:'flex',gap:12,flexWrap:'wrap',marginTop:28}}>
      <Link href={trial} style={{...button,background:'#fff',color:'#123a5b'}}>Start Your 1-Month Free Trial</Link>
      <Link href={demo} style={{...button,border:'1px solid #b8d2e4',color:'#fff'}}>Explore the sample</Link>
     </div>
     <p style={{fontSize:14,color:'#d8e6ef'}}>One calendar month from account creation. No business data is needed to explore the sample.</p>
    </div>
    <div aria-label="Illustrative dashboard preview" style={{background:'#fff',color:'#18334a',padding:22,borderRadius:18,boxShadow:'0 20px 55px #09223855'}}>
     <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center'}}><strong>Business overview</strong><span style={{fontSize:12,color:'#53697a'}}>ILLUSTRATIVE DATA</span></div>
     <p style={{fontSize:13,color:'#53697a'}}>An example of how performance can be presented</p>
     <div style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:12}}>
      <div style={{background:'#eef5f9',borderRadius:10,padding:16}}><small>Sample revenue</small><div style={{fontSize:26,fontWeight:800}}>$24,800</div></div>
      <div style={{background:'#eef5f9',borderRadius:10,padding:16}}><small>Sample orders</small><div style={{fontSize:26,fontWeight:800}}>320</div></div>
     </div>
     <div style={{marginTop:16,border:'1px solid #e3eaf0',padding:16,borderRadius:10}}>
      <strong style={{fontSize:14}}>Sample performance trend</strong>
      <svg viewBox="0 0 420 150" role="img" aria-label="Illustrative upward-trending line, not actual customer results" style={{display:'block',width:'100%',marginTop:12}}>
       <path d="M0 125 H420 M0 80 H420 M0 35 H420" stroke="#e3ebf1" strokeWidth="1" fill="none"/>
       <polyline points="10,125 65,105 120,113 175,78 230,88 285,55 340,65 410,20" fill="none" stroke="#17789b" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
     </div>
     <p style={{fontSize:12,color:'#53697a',marginBottom:0}}>Preview only. Figures do not represent real customers or guaranteed results.</p>
    </div>
   </div>
  </section>
  <section id="features" style={{maxWidth:1160,margin:'auto',padding:'72px 24px'}}>
   <p style={{color:'#174f76',fontWeight:700,letterSpacing:1}}>WHY AVERIDI DASHBOARD</p>
   <h2 style={{fontSize:'clamp(28px,4vw,40px)',margin:'8px 0 12px'}}>Clarity without guesswork</h2>
   <p style={{maxWidth:680,color:'#526679'}}>Useful dashboards start with trustworthy calculations, not just attractive charts.</p>
   <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,240px),1fr))',gap:18,marginTop:30}}>
    {features.map(item=><article key={item.title} style={{background:'#fff',border:'1px solid #e0e7ee',borderRadius:14,padding:24}}><h3 style={{marginTop:0}}>{item.title}</h3><p style={{color:'#526679'}}>{item.detail}</p></article>)}
   </div>
  </section>
  <section id="how-it-works" style={{background:'#eaf1f7'}}>
   <div style={{maxWidth:1160,margin:'auto',padding:'72px 24px'}}>
    <h2 style={{fontSize:'clamp(28px,4vw,40px)'}}>From your first file to your first dashboard</h2>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,220px),1fr))',gap:18}}>
     {steps.map((item,i)=><article key={item.title} style={{background:'#fff',padding:24,borderRadius:14}}><span style={{color:'#174f76',fontWeight:800}}>STEP {i+1}</span><h3>{item.title}</h3><p>{item.detail}</p></article>)}
    </div>
    <p style={{marginTop:24}}>Not every metric can be calculated from every file. If data is missing or ambiguous, Dashboard explains what needs attention instead of inventing a result.</p>
   </div>
  </section>
  <section id="trial" style={{maxWidth:820,margin:'auto',padding:'80px 24px',textAlign:'center'}}>
   <p style={{fontWeight:700,color:'#174f76'}}>TRY AVERIDI DASHBOARD</p>
   <h2 style={{fontSize:'clamp(30px,4vw,44px)',lineHeight:1.2}}>See what your business data can tell you.</h2>
   <p style={{fontSize:18,color:'#526679'}}>Start with a one-calendar-month trial, create your business workspace and build a dashboard from the data you choose to provide.</p>
   <div style={{display:'flex',justifyContent:'center',flexWrap:'wrap',gap:12,marginTop:26}}>
    <Link href={trial} style={{...button,background:'#174f76',color:'#fff'}}>Start Your 1-Month Free Trial</Link>
    <Link href={demo} style={{...button,border:'1px solid #b8c6d4',color:'#174f76'}}>Explore a sample first</Link>
   </div>
   <div aria-label="Trial and paid access"><p>No payment card is required to create a trial account. A paid subscription is a separate checkout; trial expiry does not automatically create one.</p><p>After expiry, an active subscription is required to open saved dashboards and continue analysis. Your workspace is retained; you can sign in to review subscription options.</p>{offer.plans.length?<><h3>Available Dashboard plans</h3>{offer.plans.map(plan=><p key={plan.name}><strong>{plan.name}</strong>: {new Intl.NumberFormat('en-US',{style:'currency',currency:plan.currency}).format(plan.amountMinor/10**new Intl.NumberFormat('en-US',{style:'currency',currency:plan.currency}).resolvedOptions().maximumFractionDigits!)} per {plan.billingInterval}</p>)}</>:<p>Online plan pricing is not currently available in this environment. Review subscription availability before relying on continued paid access.</p>}</div><p style={{fontSize:14,color:'#526679'}}>Your trial is measured from account creation. Existing accounts do not receive a new trial when they create another workspace. Paid plans are managed separately inside Dashboard.</p>
  </section>
  <footer style={{borderTop:'1px solid #e0e7ee',background:'#fff',padding:'24px',textAlign:'center',fontSize:14,color:'#526679'}}>Averidi Dashboard · Independent business analytics application · <Link href="/login">Sign in</Link></footer>
 </main>;
}

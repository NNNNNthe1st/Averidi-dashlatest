import AuditHistory from '../../components/workspace/AuditHistory';
export default function ActivityPage(){return <main style={{maxWidth:1100,margin:'auto',padding:24,overflowWrap:'anywhere',minWidth:0}}><h1>Account activity</h1><p><a href="/dashboard/app/settings">Account settings</a></p><AuditHistory url="/dashboard/app/api/account/activity"/></main>;}

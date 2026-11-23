import SalesDemo from '../../components/sales/SalesDemo';
import {buildSalesDemo} from '../../features/demo/sales';
export const metadata={title:'Explore the Sales dashboard | Averidi Dashboard'};
export default function DemoPage(){return <main><SalesDemo initial={buildSalesDemo()}/></main>;}

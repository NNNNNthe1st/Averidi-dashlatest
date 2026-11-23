import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summarizeAudit} from '../scripts/security/audit.mjs';
test('security gate fails closed on unavailable scans and distinguishes blocking findings',()=>{
 for(const value of [{},{error:{message:'private token'}},{metadata:{vulnerabilities:{}},vulnerabilities:{bad:{severity:'invented'}}}])assert.throws(()=>summarizeAudit(value));
 assert.equal(summarizeAudit({metadata:{vulnerabilities:{}},vulnerabilities:{}}).status,'PASSED');
 const finding={range:'<2',via:[{source:123,title:'Example advisory',url:'https://github.com/advisories/GHSA-example'}],nodes:['node_modules/example'],isDirect:true,fixAvailable:true};
 for(const severity of ['high','critical'])assert.equal(summarizeAudit({metadata:{vulnerabilities:{}},vulnerabilities:{example:{...finding,severity}}}).status,'BLOCKED');
 assert.equal(summarizeAudit({metadata:{vulnerabilities:{}},vulnerabilities:{example:{...finding,severity:'moderate'}}}).status,'PASSED');
});

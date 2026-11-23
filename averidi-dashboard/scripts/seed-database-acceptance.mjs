// Used only inside the uniquely named disposable acceptance container.
import {PrismaClient} from '@prisma/client';
import * as fixtureModule from '../tests/fixtures/database-domains.ts';
const {databaseDomainFixture}=fixtureModule.default??fixtureModule;
const url=new URL(process.env.DASHBOARD_DATABASE_URL??'');
if(!['127.0.0.1','localhost'].includes(url.hostname)||decodeURIComponent(url.pathname)!=='/dashboard_test')throw new Error('Acceptance seed requires the loopback dashboard_test database.');
const db=new PrismaClient({datasources:{db:{url:url.toString()}}});
try{await db.$transaction(tx=>databaseDomainFixture(tx),{timeout:30000});console.log('Full Dashboard domain fixture persisted for backup acceptance.');}
finally{await db.$disconnect();}

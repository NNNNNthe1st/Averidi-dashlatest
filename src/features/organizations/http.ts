import {quotaHttpError} from '../quotas/http';
import {NextResponse} from 'next/server';
import {Prisma} from '@prisma/client';
export const headers={'Cache-Control':'private, no-store'};
export function accountError(error:unknown){const quota=quotaHttpError(error);if(quota)return quota;
 const code=error instanceof Error?error.message:'UNAVAILABLE';
 const status=code==='FORBIDDEN'?403:code==='NOT_FOUND'?404:['VERSION_CONFLICT','LAST_OWNER','ORGANIZATION_IN_USE'].includes(code)||error instanceof Prisma.PrismaClientKnownRequestError&&['P2003','P2034'].includes(error.code)?409:['INVALID_QUERY','INVALID_INVITATION','INVALID_MEMBER'].includes(code)?400:500;
 return NextResponse.json({error:status===500?'UNAVAILABLE':status===409&&!['VERSION_CONFLICT','LAST_OWNER','ORGANIZATION_IN_USE'].includes(code)?'VERSION_CONFLICT':code},{status,headers});
}

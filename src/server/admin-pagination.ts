/** Cursor pagination is limited to predictable, bounded administrative listings. */
export function readAdminPage(request:Request){
 const params=new URL(request.url).searchParams;
 if(params.getAll("limit").length>1||params.getAll("cursor").length>1)return null;
 const limitRaw=params.get("limit");
 const limit=limitRaw===null?50:/^[1-9][0-9]{0,2}$/.test(limitRaw)?Number(limitRaw):NaN;
 const cursor=params.get("cursor");
 if(!Number.isInteger(limit)||limit<1||limit>100)return null;
 if(cursor!==null&&!/^[a-zA-Z0-9_-]{1,128}$/.test(cursor))return null;
 return {take:limit+1,cursor:cursor?{id:cursor}:undefined,skip:cursor?1:0,limit};
}
export function adminPageResult<T extends {id:string}>(rows:T[],limit:number){
 const hasMore=rows.length>limit;
 const items=hasMore?rows.slice(0,limit):rows;
 return {items,nextCursor:hasMore?items.at(-1)?.id??null:null};
}

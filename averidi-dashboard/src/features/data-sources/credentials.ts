import {randomBytes,createCipheriv,createDecipheriv} from "node:crypto";

/** Connector secret envelopes: encryption is scoped by workspace and source, never by website credentials. */
function requireKey(encoded:string|undefined):Buffer{
 if(!encoded||!/^[0-9a-fA-F]{64}$/.test(encoded))throw new Error("DASHBOARD_CONNECTOR_ENCRYPTION_KEY must be a 32-byte hex key.");
 return Buffer.from(encoded,"hex");
}
function boundAAD(workspaceId:string,sourceId:string){
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(workspaceId)||!/^[A-Za-z0-9_-]{1,128}$/.test(sourceId))
  throw new Error("Invalid Dashboard credential scope.");
 return Buffer.from("dashboard-connector-v1:"+workspaceId+":"+sourceId);
}
export function sealDashboardCredential(value:string,workspaceId:string,sourceId:string,key=process.env.DASHBOARD_CONNECTOR_ENCRYPTION_KEY){
 if(!value||value.length>32768)throw new Error("Invalid credential payload.");
 const nonce=randomBytes(12),cipher=createCipheriv("aes-256-gcm",requireKey(key),nonce);
 cipher.setAAD(boundAAD(workspaceId,sourceId));
 const bytes=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);
 return "v1:"+nonce.toString("base64url")+":"+bytes.toString("base64url")+":"+cipher.getAuthTag().toString("base64url");
}
export function openDashboardCredential(sealed:string,workspaceId:string,sourceId:string,key=process.env.DASHBOARD_CONNECTOR_ENCRYPTION_KEY){
 const parts=sealed.split(":");
 if(parts.length!==4||parts[0]!=="v1")throw new Error("Invalid Dashboard credential envelope.");
 const [_,nonceEncoded,bodyEncoded,tagEncoded]=parts;
 const nonce=Buffer.from(nonceEncoded,"base64url"),tag=Buffer.from(tagEncoded,"base64url"),bytes=Buffer.from(bodyEncoded,"base64url");
 if(nonce.length!==12||tag.length!==16||bytes.length>32768)throw new Error("Invalid Dashboard credential envelope.");
 const decipher=createDecipheriv("aes-256-gcm",requireKey(key),nonce);
 decipher.setAAD(boundAAD(workspaceId,sourceId));
 decipher.setAuthTag(tag);
 return Buffer.concat([decipher.update(bytes),decipher.final()]).toString("utf8");
}

import {rm} from 'node:fs/promises';
// Generated app output only; a complete acceptance build must not reuse an older runtime's cache.
await rm(new URL('../.next',import.meta.url),{recursive:true,force:true,maxRetries:3,retryDelay:100});
console.log('Removed generated Next.js output for a clean verification build.');

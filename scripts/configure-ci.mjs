import {readFileSync,writeFileSync} from 'node:fs';
const id=process.env.D1_DATABASE_ID;
if(!id || !/^[a-f0-9-]{36}$/i.test(id) || id==='00000000-0000-0000-0000-000000000000')throw new Error('ตั้งค่า GitHub Actions variable D1_DATABASE_ID เป็นรหัสฐานข้อมูลจริง');
const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));config.d1_databases[0].database_id=id;writeFileSync('wrangler.jsonc',JSON.stringify(config,null,2)+'\n');

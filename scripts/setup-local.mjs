import {randomBytes} from 'node:crypto';import {writeFileSync,existsSync} from 'node:fs';
if(existsSync('.dev.vars')){console.log('พบ .dev.vars แล้ว ไม่เขียนทับค่าเดิม');process.exit(0);}
writeFileSync('.dev.vars',`SESSION_SECRET="${randomBytes(32).toString('hex')}"
RESEND_API_KEY=""
LARK_APP_SECRET=""
`,{mode:0o600});
console.log('สร้าง .dev.vars แล้ว เติม Resend API key หรือค่าของ Lark App ก่อนเข้าสู่ระบบ ไม่มีรหัสผ่านกลาง');

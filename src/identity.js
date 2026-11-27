import {HttpError,requireValue} from './domain.js';
import {hash,secureEqual,sessionToken,cookie,randomCode} from './auth.js';
const sql=(env,q,...args)=>env.DB.prepare(q).bind(...args);
const json=(value,status=200,headers={})=>Response.json(value,{status,headers:{'cache-control':'no-store',...headers}});
export function normalizeEmail(value){
 requireValue(typeof value==='string' && value.length<=254,'กรุณากรอกอีเมลให้ถูกต้อง');
 const email=value.trim().toLowerCase();
 requireValue(/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(email),'กรุณากรอกอีเมลให้ถูกต้อง');return email;
}
export function adminEmails(env){return String(env.ADMIN_EMAILS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);}
export function authAvailability(env){return {email:!!(env.RESEND_API_KEY && env.EMAIL_FROM && env.SESSION_SECRET?.length>=32),lark:!!(env.LARK_APP_ID && env.LARK_APP_SECRET && env.LARK_TENANT_KEY && env.APP_URL && env.SESSION_SECRET?.length>=32)};}
export async function principalForEmail(env,email){
 if(adminEmails(env).includes(email))return {role:'admin',id:'admin:'+await hash(email),email,name:email,version:1};
 const hr=await sql(env,'SELECT email,name,auth_version FROM hr_users WHERE email=? AND active=1',email).first();
 if(hr)return {role:'hr',id:'hr:'+hr.email.toLowerCase(),email:hr.email.toLowerCase(),name:hr.name,version:hr.auth_version};
 const e=await sql(env,'SELECT id,name,email,department,auth_version FROM employees WHERE email=? AND active=1',email).first();
 return e?{role:'employee',id:e.id,email:e.email,name:e.name,department:e.department,version:e.auth_version}:null;
}
async function throttle(request,env,kind,email=''){
 const now=Date.now(),bucket=Math.floor(now/3600000),ip=request.headers.get('cf-connecting-ip')||'local';
 for(const [label,max] of [[`${kind}:ip:${ip}`,kind==='email-request'?30:100],[`${kind}:account:${email||ip}`,kind==='email-request'?5:30]]){
  const key=await hash(`${label}:${bucket}`);const row=await sql(env,'INSERT INTO login_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count',key,(bucket+1)*3600000).first();
  requireValue(row.count<=max,'ทำรายการหลายครั้ง กรุณารอสักครู่แล้วลองใหม่',429);
 }
}
function readCookie(request,name){return request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1)||'';}
function flowCookie(name,value,request,path,maxAge,sameSite='Strict'){
 return `${name}=${value}; Path=${path}; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAge}${new URL(request.url).protocol==='https:'?'; Secure':''}`;
}
function newOtp(){const limit=4294000000;let n;do{n=crypto.getRandomValues(new Uint32Array(1))[0];}while(n>=limit);return String(n%1000000).padStart(6,'0');}
async function otpHash(env,id,code){return hash(`${env.SESSION_SECRET}:email:${id}:${code}`);}
async function signedIn(request,env,principal,method){
 const s={...principal,auth_method:method};
 await sql(env,'INSERT INTO audit_log VALUES(?,?,?,?,?)',crypto.randomUUID(),principal.email,'sign_in_'+method,principal.id,Date.now()).run();
 return json({user:s},200,{'set-cookie':cookie(await sessionToken(s,env.SESSION_SECRET),request)});
}
// จับคู่บัญชี Lark กับพนักงานอัตโนมัติ (เปิดเมื่อตั้ง LARK_EMAIL_DOMAIN เท่านั้น)
// เงื่อนไข: อยู่ใน tenant บริษัท (ตรวจแล้วก่อนหน้า) + อีเมลในโปรไฟล์ Lark เป็นโดเมนบริษัท + ตรงกับพนักงานที่ผู้ดูแลเพิ่มไว้และยังไม่ผูก Lark
// ใช้กับพนักงานและบัญชี HR ที่ผู้ประเมินเพิ่มไว้ ผู้ประเมิน (admin) ยังต้องผูกผ่าน LARK_ADMIN_BINDINGS หรือเข้าด้วยอีเมล OTP
async function autoBindByCompanyEmail(env,profile){
 const domain=String(env.LARK_EMAIL_DOMAIN||'').trim().toLowerCase().replace(/^@/,'');if(!domain)return null;
 for(const raw of [profile.enterprise_email,profile.email]){
  if(typeof raw!=='string'||!raw.trim())continue;
  let email;try{email=normalizeEmail(raw);}catch{continue;}
  if(!email.endsWith('@'+domain)||adminEmails(env).includes(email))continue;
  const taken='NOT EXISTS (SELECT 1 FROM employees WHERE lark_open_id=?) AND NOT EXISTS (SELECT 1 FROM hr_users WHERE lark_open_id=?)';
  const emp=await sql(env,'SELECT id FROM employees WHERE email=? AND active=1 AND lark_open_id IS NULL',email).first();
  const hr=emp?null:await sql(env,'SELECT email FROM hr_users WHERE email=? AND active=1 AND lark_open_id IS NULL',email).first();
  if(!emp&&!hr)continue;
  const r=emp?await sql(env,`UPDATE employees SET lark_open_id=?,lark_tenant_key=? WHERE id=? AND lark_open_id IS NULL AND ${taken}`,profile.open_id,profile.tenant_key,emp.id,profile.open_id,profile.open_id).run()
   :await sql(env,`UPDATE hr_users SET lark_open_id=?,lark_tenant_key=? WHERE email=? AND lark_open_id IS NULL AND ${taken}`,profile.open_id,profile.tenant_key,hr.email,profile.open_id,profile.open_id).run();
  if(!r.meta.changes)return null;
  await sql(env,'INSERT INTO audit_log VALUES(?,?,?,?,?)',crypto.randomUUID(),email,'lark_auto_bind',emp?emp.id:'hr:'+email,Date.now()).run();
  return principalForEmail(env,email);
 }
 return null;
}
export async function handleIdentity(request,env,readBody,fetcher=fetch){
 const url=new URL(request.url),path=url.pathname;
 if(path==='/api/login')throw new HttpError(410,'ใช้การเข้าสู่ระบบผ่านอีเมลหรือ Lark เท่านั้น');
 if(path==='/api/auth/email/request' && request.method==='POST'){
  requireValue(authAvailability(env).email,'ยังไม่ได้ตั้งค่าบริการส่งอีเมล กรุณาติดต่อผู้ดูแล',503);
  const email=normalizeEmail((await readBody(request)).email);await throttle(request,env,'email-request',email);
  const id=randomCode(),code=newOtp(),principal=await principalForEmail(env,email);
  // Return the same response for registered and unregistered addresses.
  if(principal){
   await sql(env,'INSERT INTO email_challenges(id,email,code_hash,expires_at) VALUES(?,?,?,?)',await hash(id),email,await otpHash(env,id,code),Date.now()+600000).run();
   try{
    const response=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{authorization:`Bearer ${env.RESEND_API_KEY}`,'content-type':'application/json','idempotency-key':'login/'+await hash(id)},body:JSON.stringify({from:env.EMAIL_FROM,to:[email],subject:`${env.COMPANY_NAME||'SuperX Academy'} — รหัสยืนยันเข้าสู่ระบบ`,text:`รหัสยืนยันของคุณคือ ${code}\nใช้ได้ภายใน 10 นาที และใช้ได้เพียงครั้งเดียว\nหากคุณไม่ได้ขอเข้าสู่ระบบ กรุณาเพิกเฉยต่ออีเมลนี้\nอย่าส่งรหัสนี้ให้ผู้อื่น`}),signal:AbortSignal.timeout(15000)});
    const result=await response.json();if(!response.ok || typeof result.id!=='string')throw new Error();
    await sql(env,'UPDATE email_challenges SET ready=1 WHERE id=?',await hash(id)).run();
   }catch{
    await sql(env,'DELETE FROM email_challenges WHERE id=?',await hash(id)).run();
    // Hide provider failures from unauthenticated users to avoid account enumeration.
    await sql(env,'INSERT INTO audit_log VALUES(?,?,?,?,?)',crypto.randomUUID(),'system','email_delivery_failed','login-email',Date.now()).run();
   }
  }
  return json({ok:true,message:'หากอีเมลนี้ได้รับสิทธิ์ คุณจะได้รับรหัสยืนยันภายในไม่กี่นาที'},200,{'set-cookie':flowCookie('email_flow',id,request,'/api/auth/email',600)});
 }
 if(path==='/api/auth/email/verify' && request.method==='POST'){
  requireValue(env.SESSION_SECRET?.length>=32,'ยังไม่ได้ตั้งค่าระบบเข้าสู่ระบบ',503);
  const b=await readBody(request),email=normalizeEmail(b.email);await throttle(request,env,'email-verify',email);
  const id=readCookie(request,'email_flow');requireValue(/^[a-f0-9]{36}$/.test(id) && typeof b.code==='string' && /^\d{6}$/.test(b.code),'รหัสยืนยันไม่ถูกต้องหรือหมดอายุ',401);
  const challenge=await sql(env,'UPDATE email_challenges SET tries=tries+1 WHERE id=? AND email=? AND consumed_at IS NULL AND ready=1 AND expires_at>? AND tries<5 RETURNING *',await hash(id),email,Date.now()).first();
  requireValue(challenge && await secureEqual(challenge.code_hash,await otpHash(env,id,b.code)),'รหัสยืนยันไม่ถูกต้องหรือหมดอายุ',401);
  const principal=await principalForEmail(env,email);requireValue(principal,'บัญชีนี้ไม่มีสิทธิ์ใช้งาน',403);
  const used=await sql(env,'UPDATE email_challenges SET consumed_at=? WHERE id=? AND consumed_at IS NULL AND expires_at>?',Date.now(),challenge.id,Date.now()).run();requireValue(used.meta.changes,'รหัสนี้ถูกใช้แล้ว กรุณาขอรหัสใหม่',401);
  const response=await signedIn(request,env,principal,'email');response.headers.append('set-cookie',flowCookie('email_flow','',request,'/api/auth/email',0));return response;
 }
 if(path==='/api/auth/lark/start' && request.method==='POST'){
  requireValue(authAvailability(env).lark,'ยังไม่ได้ตั้งค่า Lark App กรุณาติดต่อผู้ดูแล',503);await throttle(request,env,'lark-start');
  const origin=new URL(env.APP_URL).origin;requireValue(origin===url.origin,'กรุณาเปิดเว็บผ่านโดเมนหลักของบริษัท',400);
  requireValue(new URL(env.APP_URL).protocol==='https:' || ['127.0.0.1','localhost'].includes(url.hostname),'ต้องใช้ HTTPS',503);
  const state=randomCode(),browser=randomCode(),verifier=randomCode()+randomCode(),redirect=new URL('/api/auth/lark/callback',origin).href;
  await sql(env,'INSERT INTO oauth_states(state_hash,browser_hash,expires_at,code_verifier) VALUES(?,?,?,?)',await hash(state),await hash(browser),Date.now()+600000,verifier).run();
  const challenge=btoa(String.fromCharCode(...Uint8Array.from((await hash(verifier)).match(/../g),x=>parseInt(x,16)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
  const authorize=new URL('https://accounts.larksuite.com/open-apis/authen/v1/authorize');
  authorize.search=new URLSearchParams({client_id:env.LARK_APP_ID,response_type:'code',redirect_uri:redirect,state,code_challenge:challenge,code_challenge_method:'S256'}).toString();
  if(env.LARK_LOGIN_SCOPES)authorize.searchParams.set('scope',env.LARK_LOGIN_SCOPES);
  return json({url:authorize.href},200,{'set-cookie':flowCookie('lark_flow',browser,request,'/api/auth/lark/callback',600,'Lax')});
 }
 if(path==='/api/auth/lark/callback' && request.method==='GET'){
  const origin=new URL(request.url).origin,clear=flowCookie('lark_flow','',request,'/api/auth/lark/callback',0,'Lax');
  try{
   requireValue(authAvailability(env).lark && new URL(env.APP_URL).origin===origin,'Lark ไม่พร้อมใช้งาน',503);
   const state=url.searchParams.get('state')||'',browser=readCookie(request,'lark_flow'),code=url.searchParams.get('code');
   requireValue(/^[a-f0-9]{36}$/.test(state) && /^[a-f0-9]{36}$/.test(browser),'สถานะยืนยันไม่ถูกต้อง',401);
   const flow=await sql(env,'DELETE FROM oauth_states WHERE state_hash=? AND browser_hash=? AND expires_at>? RETURNING *',await hash(state),await hash(browser),Date.now()).first();requireValue(flow && code && code.length<2000 && !url.searchParams.has('error'),'การยืนยันหมดอายุหรือถูกยกเลิก',401);
   const tokenResponse=await fetcher('https://open.larksuite.com/open-apis/authen/v2/oauth/token',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({grant_type:'authorization_code',client_id:env.LARK_APP_ID,client_secret:env.LARK_APP_SECRET,code,code_verifier:flow.code_verifier,redirect_uri:new URL('/api/auth/lark/callback',origin).href}),signal:AbortSignal.timeout(15000)});
   const token=await tokenResponse.json(),accessToken=token.access_token||token.data?.access_token;requireValue(tokenResponse.ok && token.code===0 && typeof accessToken==='string','ยืนยัน Lark ไม่สำเร็จ',401);
   const infoResponse=await fetcher('https://open.larksuite.com/open-apis/authen/v1/user_info',{headers:{authorization:`Bearer ${accessToken}`},signal:AbortSignal.timeout(15000)});
   const info=await infoResponse.json(),profile=info.data;requireValue(infoResponse.ok && info.code===0 && profile?.tenant_key===env.LARK_TENANT_KEY && typeof profile.open_id==='string' && profile.open_id.length<=200,'บัญชี Lark อยู่นอกบริษัทที่อนุญาต',403);
   let principal=null;
   // Lark contact email is not proof of mailbox ownership. Only explicit bindings grant access.
   let admins={};try{admins=JSON.parse(env.LARK_ADMIN_BINDINGS||'{}');}catch{throw new HttpError(503,'การตั้งค่าบัญชี Lark ไม่ถูกต้อง');}
   if(Object.hasOwn(admins,profile.open_id)){
    const email=normalizeEmail(admins[profile.open_id]);requireValue(adminEmails(env).includes(email),'ผู้ประเมินยังไม่ได้รับสิทธิ์',403);principal=await principalForEmail(env,email);
   }else{
    const bound=await sql(env,'SELECT id,email FROM employees WHERE lark_open_id=? AND lark_tenant_key=? AND active=1',profile.open_id,profile.tenant_key).first();
    const boundHr=bound?null:await sql(env,'SELECT email FROM hr_users WHERE lark_open_id=? AND lark_tenant_key=? AND active=1',profile.open_id,profile.tenant_key).first();
    if(bound?.email){principal=await principalForEmail(env,bound.email);requireValue(principal?.role==='employee','บัญชีนี้ไม่ใช่พนักงาน',403);}
    else if(boundHr){principal=await principalForEmail(env,boundHr.email.toLowerCase());requireValue(principal?.role==='hr','บัญชีนี้ไม่ใช่ฝ่าย HR',403);}
    else if(!bound)principal=await autoBindByCompanyEmail(env,profile);
   }
   requireValue(principal,'บัญชี Lark นี้ยังไม่ได้รับการผูกสิทธิ์จากผู้ดูแล',403);
   principal={...principal,lark_open_id:profile.open_id,lark_tenant_key:profile.tenant_key};
   const session=await signedIn(request,env,principal,'lark');
   const headers=new Headers({'location':'/','cache-control':'no-store'});headers.append('set-cookie',session.headers.get('set-cookie'));headers.append('set-cookie',clear);return new Response(null,{status:303,headers});
  }catch{return new Response(null,{status:303,headers:{location:'/?auth_error=lark','cache-control':'no-store','set-cookie':clear}});}
 }
 return null;
}

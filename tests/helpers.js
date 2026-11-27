import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createWorker} from '../src/worker.js';
export function sqliteD1() {
  const db = new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../migrations/0001_initial.sql',import.meta.url),'utf8'));db.exec(readFileSync(new URL('../migrations/0002_email_lark_auth.sql',import.meta.url),'utf8'));db.exec(readFileSync(new URL('../migrations/0003_lark_pkce.sql',import.meta.url),'utf8'));db.exec(readFileSync(new URL('../migrations/0004_hr_certificates.sql',import.meta.url),'utf8'));db.exec(readFileSync(new URL('../migrations/0005_exam_archive.sql',import.meta.url),'utf8'));
  function prepare(sql,args=[]) {
    return {bind(...values){return prepare(sql,values);},async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){const r=db.prepare(sql).run(...args);return {success:true,meta:{changes:Number(r.changes)}};},_run(){return this.run();}};
  }
  return {prepare,async batch(statements){db.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}},close(){db.close();},raw:db};
}
export function fixture(){
  const env={DB:sqliteD1(),ADMIN_EMAILS:'assessor@company.test',RESEND_API_KEY:'test-email-api-key',EMAIL_FROM:'noreply@company.test',SESSION_SECRET:'session-test-only-secret-over-32-characters',COMPANY_NAME:'SuperX Academy',ASSETS:{fetch:async()=>new Response('ok')}};
  const pending=[],mails=[];let cookie='',external=null;
  const worker=createWorker(async(url,options)=>{if(external)return external(url,options);if(url==='https://api.resend.com/emails'){const b=JSON.parse(options.body);mails.push(b);return Response.json({id:crypto.randomUUID()});}throw new Error('Unexpected external call');});
  const ctx={waitUntil(p){pending.push(p);}};
  async function request(path,data,opts={}){
    const origin='https://test.example';const headers={origin,...(data===undefined?{}:{'content-type':'application/json'}),cookie,...opts.headers};
    const req=new Request(origin+'/api'+path,{method:opts.method || (data===undefined?'GET':'POST'),headers,body:data===undefined?undefined:JSON.stringify(data)});
    const res=await worker.fetch(req,env,ctx);
    const jar=new Map(cookie.split(';').map(x=>x.trim()).filter(Boolean).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1)];}));
    for(const set of res.headers.getSetCookie()){const first=set.split(';')[0],i=first.indexOf('=');if(first.slice(i+1))jar.set(first.slice(0,i),first.slice(i+1));else jar.delete(first.slice(0,i));}
    cookie=[...jar].map(([k,v])=>k+'='+v).join('; ');
    const type=res.headers.get('content-type')||'';return {status:res.status,headers:res.headers,body:type.includes('application/json')?await res.json():await res.text()};
  }
  function lastCode(email){return mails.filter(m=>m.to[0]===email).at(-1)?.text.match(/\b[0-9]{6}\b/)?.[0];}
  async function emailLogin(email){const requested=await request('/auth/email/request',{email});if(requested.status!==200)return requested;return request('/auth/email/verify',{email,code:lastCode(email)||'000000'});}
  return {env,ctx,request,pending,mails,lastCode,emailLogin,setExternal(fn){external=fn;},get cookie(){return cookie;},set cookie(value){cookie=value;},async admin(){const r=await emailLogin('assessor@company.test');if(r.status!==200)throw new Error(JSON.stringify(r));},async employee(id){const e=await env.DB.prepare('SELECT email FROM employees WHERE id=?').bind(id).first();return emailLogin(e.email);},async drain(){await Promise.all(pending);}};
}
export const examInput=(department='technical',mixed=true)=>({title:'การประเมินทักษะ',department,duration_minutes:30,pass_percent:95,questions:[{type:'mcq',prompt:'ข้อเลือกตอบ',topic:'เทคนิค',points:mixed?60:100,options:['A','B'],correct:1,explanation:'ตอบ B'},...(mixed?[{type:'essay',prompt:'อธิบายขั้นตอน',topic:'การแก้ปัญหา',points:40,rubric:'ตรวจสอบ ทดสอบ และสรุปผล',keywords:['ตรวจสอบ','ทดสอบ']}]:[])]});
export async function prepareExam(f,options={}) {
  await f.admin();const input=examInput(options.department||'technical',options.mixed??true);
  const created=await f.request('/admin/exams',input);const examId=created.body.id;
  if(options.publish!==false)await f.request('/admin/exams/'+examId+'/publish',{published:true});
  const emp=await f.request('/admin/employees',{id:options.employeeId||'SX-001',name:'พนักงาน ทดสอบ',department:options.department||'technical',email:(options.employeeId||'SX-001').toLowerCase()+'@company.test'});
  const adminCookie=f.cookie;await f.employee(emp.body.employee.id,emp.body.code);
  return {examId,employee:emp.body.employee,email:emp.body.employee.email,adminCookie};
}
export async function startAndSubmit(f,examId,answers={q1:1,q2:'ตรวจสอบและทดสอบ'}) {
  const started=await f.request('/attempts',{exam_id:examId});
  const a=started.body.attempt;
  const submitted=await f.request('/attempts/'+a.id+'/submit',{answers,revision:a.revision});
  return submitted.body.attempt;
}

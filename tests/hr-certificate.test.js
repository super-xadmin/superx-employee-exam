import test from 'node:test';import assert from 'node:assert/strict';
import {fixture,prepareExam,startAndSubmit} from './helpers.js';
const hrEmail='hr@company.test';
async function addHr(f,adminCookie){f.cookie=adminCookie;const r=await f.request('/admin/hr',{name:'ฝ่ายบุคคล',email:hrEmail});assert.equal(r.status,201);f.cookie='';const login=await f.emailLogin(hrEmail);assert.equal(login.status,200);assert.equal(login.body.user.role,'hr');}

test('HR signs in by OTP, sees pass/fail report and CSV, but cannot use admin or employee APIs',async()=>{
 const f=fixture();const {examId,adminCookie}=await prepareExam(f,{mixed:false});const a=await startAndSubmit(f,examId,{q1:1});assert.equal(a.status,'passed');
 await addHr(f,adminCookie);
 const me=await f.request('/me');assert.equal(me.body.user.role,'hr');assert.equal(me.body.user.name,'ฝ่ายบุคคล');
 const report=await f.request('/reports/results');assert.equal(report.status,200);assert.equal(report.body.attempts.length,1);assert.equal(report.body.attempts[0].status,'passed');assert.match(report.body.attempts[0].certificate_no,/^SXA-\d{4}-[0-9A-F]{8}$/);
 assert.equal(report.body.attempts[0].answers,undefined);assert.equal(report.body.attempts[0].snapshot_json,undefined);
 const csv=await f.request('/reports/export');assert.equal(csv.status,200);assert.match(csv.body,/เลขที่ใบประกาศ/);assert.match(csv.body,/SXA-/);
 for(const [path,data] of [['/admin/overview'],['/admin/export'],['/admin/employees',{id:'X1',name:'x',department:'sales',email:'x@company.test'}],['/admin/hr',{name:'y',email:'y@company.test'}],['/admin/exams/'+examId+'/publish',{published:false}]])assert.equal((await f.request(path,data)).status,403,path);
 assert.equal((await f.request('/exams')).status,403);assert.equal((await f.request('/attempts/'+a.id)).status,404);
});

test('certificate is available only for passed attempts to the owner, HR and admin, in English',async()=>{
 const f=fixture();const {examId,adminCookie}=await prepareExam(f,{mixed:false});
 f.cookie=adminCookie;assert.equal((await f.request('/admin/employees/SX-001/profile',{name_en:'Somchai Jaidee'})).status,200);
 await f.employee('SX-001');const a=await startAndSubmit(f,examId,{q1:1});
 const mine=await f.request('/certificates/'+a.id);assert.equal(mine.status,200);const c=mine.body.certificate;
 assert.equal(c.name_en,'Somchai Jaidee');assert.equal(c.department_en,'Technical Department');assert.equal(c.title_en,'Technical Department Skills Assessment');assert.equal(c.percent,100);assert.match(c.number,/^SXA-/);
 f.cookie=adminCookie;assert.equal((await f.request('/certificates/'+a.id)).status,200);
 const other=await f.request('/admin/employees',{id:'SX-002',name:'อีกคน',department:'technical',email:'sx-002@company.test'});assert.equal(other.status,201);
 await f.employee('SX-002');assert.equal((await f.request('/certificates/'+a.id)).status,404);
 await addHr(f,adminCookie);assert.equal((await f.request('/certificates/'+a.id)).status,200);
});

test('no certificate for failed or pending attempts',async()=>{
 const f=fixture();const {examId}=await prepareExam(f,{mixed:false});const failed=await startAndSubmit(f,examId,{q1:0});assert.equal(failed.status,'failed');assert.equal((await f.request('/certificates/'+failed.id)).status,404);
 const g=fixture();const p=await prepareExam(g);const pending=await startAndSubmit(g,p.examId);assert.equal(pending.status,'pending_review');assert.equal((await g.request('/certificates/'+pending.id)).status,404);
});

test('HR accounts cannot overlap employees or admins and deactivation ends the session',async()=>{
 const f=fixture();const {adminCookie,email}=await prepareExam(f);f.cookie=adminCookie;
 assert.equal((await f.request('/admin/hr',{name:'ซ้ำ',email})).status,409);
 assert.equal((await f.request('/admin/hr',{name:'แอดมิน',email:'assessor@company.test'})).status,409);
 await addHr(f,adminCookie);const hrCookie=f.cookie;
 f.cookie=adminCookie;assert.equal((await f.request('/admin/employees',{id:'SX-9',name:'x',department:'sales',email:hrEmail})).status,409);
 assert.equal((await f.request('/admin/hr',{name:'ซ้ำ',email:hrEmail})).status,409);
 assert.equal((await f.request('/admin/hr/'+encodeURIComponent(hrEmail)+'/deactivate',{})).status,200);
 f.cookie=hrCookie;assert.equal((await f.request('/reports/results')).status,401);
 f.cookie='';const again=await f.emailLogin(hrEmail);assert.notEqual(again.status,200);
});

test('seeded exams carry English titles onto the certificate',async()=>{
 const f=fixture();await f.admin();await f.request('/admin/seed',{});
 const row=await f.env.DB.prepare("SELECT title_en FROM exams WHERE id='superx-sales-v1'").first();assert.equal(row.title_en,'Robovan Product Knowledge for Sales');
});

test('HR account auto-binds to Lark by company email and keeps HR role',async()=>{
 const f=fixture();await f.admin();assert.equal((await f.request('/admin/hr',{name:'ฝ่ายบุคคล',email:hrEmail})).status,201);
 Object.assign(f.env,{APP_URL:'https://test.example',LARK_APP_ID:'cli_test',LARK_APP_SECRET:'secret',LARK_TENANT_KEY:'company-tenant',LARK_EMAIL_DOMAIN:'company.test'});
 f.cookie='';const start=await f.request('/auth/lark/start',{});const state=new URL(start.body.url).searchParams.get('state');
 f.setExternal(async url=>url.endsWith('/oauth/token')?Response.json({code:0,access_token:'t'}):Response.json({code:0,data:{email:hrEmail,tenant_key:'company-tenant',open_id:'ou_hr'}}));
 assert.equal((await f.request('/auth/lark/callback?state='+state+'&code=c')).headers.get('location'),'/');
 assert.equal((await f.request('/me')).body.user.role,'hr');assert.equal((await f.request('/reports/results')).status,200);
 assert.equal((await f.env.DB.prepare('SELECT lark_open_id FROM hr_users').first()).lark_open_id,'ou_hr');
});

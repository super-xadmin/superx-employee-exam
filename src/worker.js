import { HttpError, requireValue, text, DEPARTMENTS, validateExam, publicExam, normalizeAnswers, grade, csvCell } from './domain.js';
import { readSession, cookie } from './auth.js';
import { finalize, expireAttempts, dispatchNotifications, aiAnalysis } from './services.js';
import {handleIdentity,authAvailability,normalizeEmail,adminEmails} from './identity.js';
import { sampleExams } from './seed.js';
const json = (data,status=200,headers={}) => Response.json(data,{status,headers:{'cache-control':'no-store',...headers}});
const stmt = (env,sql,...args) => env.DB.prepare(sql).bind(...args);
async function audit(env,actor,action,target) { await stmt(env,'INSERT INTO audit_log VALUES(?,?,?,?,?)',crypto.randomUUID(),actor,action,target,Date.now()).run(); }
async function body(request) {
  requireValue(request.headers.get('content-type')?.includes('application/json'),'ต้องส่งข้อมูลแบบ JSON',415);
  const reader = request.body?.getReader(); requireValue(reader,'ไม่มีข้อมูล');
  const parts=[]; let size=0;
  while (true) { const {done,value}=await reader.read(); if(done) break; size+=value.length; if(size>200000){await reader.cancel();throw new HttpError(413,'ข้อมูลยาวเกินกำหนด');} parts.push(value); }
  const all=new Uint8Array(size);let offset=0;for(const p of parts){all.set(p,offset);offset+=p.length;}
  try { const value=JSON.parse(new TextDecoder().decode(all));requireValue(value && typeof value==='object' && !Array.isArray(value),'ข้อมูลไม่ถูกต้อง');return value; } catch(e) {if(e instanceof HttpError)throw e;throw new HttpError(400,'ข้อมูลไม่ถูกต้อง');}
}
function serializeAttempt(a,admin=false) {
  const exam=JSON.parse(a.snapshot_json);
  const out={id:a.id,employee_id:a.employee_id,exam_id:a.exam_id,attempt_no:a.attempt_no,status:a.status,deadline:a.deadline,started_at:a.started_at,submitted_at:a.submitted_at,reviewed_at:a.reviewed_at,reviewer:a.reviewer,revision:a.revision,exam:admin?exam:publicExam(exam),answers:JSON.parse(a.answers_json)};
  if(a.result_json) {const r=JSON.parse(a.result_json);out.result=admin?r:{...r,questions:r.questions.map(q=>({...q,feedback:a.status==='pending_review'?'':q.score===null?'':q.feedback}))};}
  if(admin)out.analysis=a.analysis_json?JSON.parse(a.analysis_json):null;
  return out;
}
async function route(request,env,ctx,fetcher) {
  const url=new URL(request.url),path=url.pathname,method=request.method;
  if(!path.startsWith('/api/')) return env.ASSETS.fetch(request);
  if(!['GET','HEAD'].includes(method)) requireValue(request.headers.get('origin')===url.origin,'ที่มาของคำขอไม่ถูกต้อง',403);
  if(path==='/api/config' && method==='GET') return json({company:env.COMPANY_NAME || 'SuperX Academy',departments:DEPARTMENTS,pass_percent:95,max_attempts:2,auth:authAvailability(env)});
  if(path==='/api/logout' && method==='POST') return json({ok:true},200,{'set-cookie':cookie('',request,true)});
  const identity=await handleIdentity(request,env,body,fetcher);if(identity)return identity;
  const user=await readSession(request,env);
  if(path==='/api/me' && method==='GET')return json({user:{role:user.role,id:user.id,name:user.name,email:user.email,department:user.department}});
  if(path.startsWith('/api/admin/')) requireValue(user.role==='admin','เฉพาะผู้ประเมิน',403);
  if(path==='/api/exams' && method==='GET') {
    requireValue(user.role==='employee','เฉพาะพนักงาน',403);
    await expireAttempts(env);
    const {results:exams}=await stmt(env,'SELECT id,title,department,duration_minutes,pass_percent,questions_json FROM exams WHERE published=1 AND department=? ORDER BY created_at DESC',user.department).all();
    const {results:attempts}=await stmt(env,'SELECT id,exam_id,attempt_no,status,result_json FROM attempts WHERE employee_id=? ORDER BY attempt_no',user.id).all();
    return json({exams:exams.map(({questions_json,...e})=>({...e,count:JSON.parse(questions_json).length,total:JSON.parse(questions_json).reduce((s,q)=>s+q.points,0),attempts:attempts.filter(a=>a.exam_id===e.id).map(({result_json,...a})=>({...a,result:result_json?JSON.parse(result_json):null}))}))});
  }
  if(path==='/api/attempts' && method==='POST') {
    requireValue(user.role==='employee','เฉพาะพนักงาน',403);
    const b=await body(request),e=await stmt(env,'SELECT * FROM exams WHERE id=? AND published=1 AND department=?',text(b.exam_id),user.department).first();
    requireValue(e,'ไม่พบข้อสอบสำหรับฝ่ายของคุณ',404);
    let last=await stmt(env,'SELECT * FROM attempts WHERE employee_id=? AND exam_id=? ORDER BY attempt_no DESC LIMIT 1',user.id,e.id).first();
    if(last?.status==='in_progress') {if(last.deadline<Date.now())last=await finalize(env,last,JSON.parse(last.answers_json));return json({attempt:serializeAttempt(last)});}
    requireValue(!last || (last.attempt_no===1 && last.status==='failed'),'สอบซ่อมได้ 1 ครั้ง เฉพาะเมื่อผลครั้งแรกไม่ผ่าน',409);
    const exam={...e,questions:JSON.parse(e.questions_json)};delete exam.questions_json;
    const id=crypto.randomUUID(),now=Date.now(),number=last?2:1;
    // Uniqueness resolves concurrent starts and prevents a third attempt.
    await stmt(env,`INSERT OR IGNORE INTO attempts(id,employee_id,exam_id,snapshot_json,started_at,deadline,attempt_no) VALUES(?,?,?,?,?,?,?)`,id,user.id,e.id,JSON.stringify(exam),now,now+e.duration_minutes*60000,number).run();
    const attempt=await stmt(env,'SELECT * FROM attempts WHERE employee_id=? AND exam_id=? AND attempt_no=?',user.id,e.id,number).first();
    return json({attempt:serializeAttempt(attempt)},201);
  }
  const match=path.match(/^\/api\/attempts\/([\w-]+)(?:\/(save|submit))?$/);
  if(match) {
    let a=await stmt(env,'SELECT * FROM attempts WHERE id=?',match[1]).first();requireValue(a && (user.role==='admin' || a.employee_id===user.id),'ไม่พบรายการสอบ',404);
    if(method==='GET' && !match[2]) {if(a.status==='in_progress' && a.deadline<Date.now())a=await finalize(env,a,JSON.parse(a.answers_json));return json({attempt:serializeAttempt(a,user.role==='admin')});}
    requireValue(user.role==='employee','เฉพาะเจ้าของการสอบ',403);
    if(method==='POST' && ['save','submit'].includes(match[2])) {
      const b=await body(request);
      if(a.status!=='in_progress')return json({attempt:serializeAttempt(a)});
      const exam=JSON.parse(a.snapshot_json),answers=normalizeAnswers(exam,b.answers);
      requireValue(Number.isInteger(b.revision) && b.revision===a.revision,'ข้อมูลถูกแก้ไขในอีกหน้าต่าง กรุณาโหลดหน้าใหม่',409);
      if(match[2]==='save' && Date.now()<=a.deadline) {
        const change=await stmt(env,"UPDATE attempts SET answers_json=?, revision=revision+1 WHERE id=? AND status='in_progress' AND revision=? AND deadline>=?",JSON.stringify(answers),a.id,a.revision,Date.now()).run();
        requireValue(change.meta.changes,'ข้อมูลเปลี่ยนแปลงหรือหมดเวลา กรุณาโหลดหน้าใหม่',409);
        return json({revision:a.revision+1,saved_at:Date.now()});
      }
      a=await finalize(env,a,answers);
      if(a.status==='in_progress')throw new HttpError(409,'ข้อมูลเปลี่ยนแปลง กรุณาโหลดหน้าใหม่');
      ctx.waitUntil(dispatchNotifications(env).catch(()=>{}));return json({attempt:serializeAttempt(a)});
    }
  }
  if(path==='/api/admin/overview' && method==='GET') {
    await expireAttempts(env);
    const {results:employees}=await env.DB.prepare('SELECT id,name,email,department,lark_open_id,active,created_at FROM employees ORDER BY created_at DESC LIMIT 1000').all();
    const {results:exams}=await env.DB.prepare('SELECT * FROM exams ORDER BY created_at DESC LIMIT 200').all();
    const {results:attempts}=await env.DB.prepare('SELECT a.id,a.employee_id,a.exam_id,a.attempt_no,a.status,a.result_json,a.submitted_at,a.started_at,e.name,e.department FROM attempts a JOIN employees e ON e.id=a.employee_id ORDER BY a.started_at DESC LIMIT 1000').all();
    const {results:notifications}=await env.DB.prepare('SELECT id,attempt_id,state,tries,last_error,sent_at FROM notifications ORDER BY rowid DESC LIMIT 100').all();
    const {results:audit}=await env.DB.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 30').all();
    return json({employees,exams:exams.map(({questions_json,...e})=>({...e,questions:JSON.parse(questions_json)})),attempts:attempts.map(({result_json,...a})=>({...a,result:result_json?JSON.parse(result_json):null})),notifications,audit,integrations:{lark:!!env.LARK_WEBHOOK_URL,ai:env.AI_ENABLED==='true' && !!env.AI}});
  }
  if(path==='/api/admin/employees' && method==='POST') {
    const b=await body(request),id=text(b.id,80),name=text(b.name,200);requireValue(/^[a-zA-Z0-9_-]+$/.test(id),'รหัสพนักงานใช้ตัวอักษรอังกฤษ ตัวเลข _ หรือ -');requireValue(typeof b.department==='string' && Object.hasOwn(DEPARTMENTS,b.department),'ฝ่ายไม่ถูกต้อง');
    const email=normalizeEmail(b.email);requireValue(!adminEmails(env).includes(email),'อีเมลนี้เป็นผู้ประเมิน กรุณาใช้อีเมลพนักงาน',409);
    requireValue(!await stmt(env,'SELECT id FROM employees WHERE id=? OR email=?',id,email).first(),'รหัสพนักงานหรืออีเมลนี้มีแล้ว',409);
    await env.DB.batch([stmt(env,"INSERT INTO employees(id,name,department,email,code_hash,created_at) VALUES(?,?,?,?,'',?)",id,name,b.department,email,Date.now()),stmt(env,'INSERT INTO audit_log VALUES(?,?,?,?,?)',crypto.randomUUID(),user.email,'create_employee',id,Date.now())]);
    return json({employee:{id,name,email,department:b.department}},201);
  }
  const emp=path.match(/^\/api\/admin\/employees\/([\w-]+)\/(identity|deactivate)$/);
  if(emp && method==='POST') {
    const b=await body(request);
    if(emp[2]==='identity'){
      const email=normalizeEmail(b.email);requireValue(!adminEmails(env).includes(email),'อีเมลนี้เป็นผู้ประเมิน',409);
      requireValue(!await stmt(env,'SELECT id FROM employees WHERE email=? AND id!=?',email,emp[1]).first(),'อีเมลนี้ถูกใช้แล้ว',409);
      const openId=typeof b.lark_open_id==='string'?b.lark_open_id.trim():'';
      requireValue(!openId || /^ou[_-][a-zA-Z0-9_-]{1,196}$/.test(openId),'Lark Open ID ไม่ถูกต้อง');
      requireValue(!openId || env.LARK_TENANT_KEY,'กรุณาตั้งองค์กร Lark ก่อนผูกบัญชี',503);
      requireValue(!openId || !await stmt(env,'SELECT id FROM employees WHERE lark_open_id=? AND id!=?',openId,emp[1]).first(),'บัญชี Lark นี้ถูกผูกแล้ว',409);
      let adminBindings={};try{adminBindings=JSON.parse(env.LARK_ADMIN_BINDINGS||'{}');}catch{}
      requireValue(!openId || !Object.hasOwn(adminBindings,openId),'บัญชีนี้เป็นผู้ประเมิน',409);
      const r=await stmt(env,'UPDATE employees SET email=?,lark_open_id=?,lark_tenant_key=?,auth_version=auth_version+1 WHERE id=?',email,openId||null,openId?env.LARK_TENANT_KEY:null,emp[1]).run();requireValue(r.meta.changes,'ไม่พบพนักงาน',404);
    }else{
      const r=await stmt(env,'UPDATE employees SET active=0,auth_version=auth_version+1 WHERE id=?',emp[1]).run();requireValue(r.meta.changes,'ไม่พบพนักงาน',404);
    }
    await audit(env,user.email,emp[2]+'_employee',emp[1]);return json({ok:true});
  }
  if(path==='/api/admin/exams' && method==='POST') {
    const exam=validateExam(await body(request)),id=crypto.randomUUID();
    await stmt(env,'INSERT INTO exams VALUES(?,?,?,?,?,?,0,?)',id,exam.title,exam.department,exam.duration_minutes,exam.pass_percent,JSON.stringify(exam.questions),Date.now()).run();
    await audit(env,user.email,'create_exam',id);return json({id},201);
  }
  if(path==='/api/admin/seed' && method==='POST') {
    for(const input of sampleExams) {
      const e=validateExam(input),id='sample-'+e.department;
      await stmt(env,'INSERT OR IGNORE INTO exams VALUES(?,?,?,?,?,?,0,?)',id,e.title,e.department,e.duration_minutes,e.pass_percent,JSON.stringify(e.questions),Date.now()).run();
    }
    await audit(env,user.email,'seed_draft_exams','samples');return json({ok:true});
  }
  const pub=path.match(/^\/api\/admin\/exams\/([\w-]+)\/publish$/);
  if(pub && method==='POST') {
    const b=await body(request);requireValue(typeof b.published==='boolean','สถานะไม่ถูกต้อง');
    const r=await stmt(env,'UPDATE exams SET published=? WHERE id=?',b.published?1:0,pub[1]).run();requireValue(r.meta.changes,'ไม่พบข้อสอบ',404);await audit(env,user.email,b.published?'publish_exam':'close_exam',pub[1]);return json({ok:true});
  }
  const review=path.match(/^\/api\/admin\/attempts\/([\w-]+)\/(review|analyze)$/);
  if(review && method==='POST') {
    const b=await body(request),a=await stmt(env,'SELECT * FROM attempts WHERE id=?',review[1]).first();requireValue(a && a.status!=='in_progress','ไม่พบผลสอบที่ส่งแล้ว',404);
    const exam=JSON.parse(a.snapshot_json),answers=JSON.parse(a.answers_json);
    if(review[2]==='analyze') {
      let ai;try{ai=await aiAnalysis(env,exam,answers);}catch{throw new HttpError(502,'วิเคราะห์ AI ไม่สำเร็จ สามารถใช้เกณฑ์ตรวจและตรวจด้วยผู้ประเมินได้');}
      requireValue(ai,'ยังไม่ได้เปิดบริการ Workers AI',503);
      const analysis=JSON.parse(a.analysis_json || '{}');analysis.ai=ai;
      await stmt(env,'UPDATE attempts SET analysis_json=? WHERE id=?',JSON.stringify(analysis),a.id).run();await audit(env,user.email,'ai_analysis',a.id);return json({analysis});
    }
    requireValue(a.status==='pending_review','ผลสอบนี้ได้รับการยืนยันแล้ว',409);
    requireValue(b.revision===a.revision,'ผลสอบมีการเปลี่ยนแปลง กรุณาโหลดใหม่',409);
    requireValue(b.reviews && typeof b.reviews==='object' && !Array.isArray(b.reviews),'กรุณาตรวจข้อเขียนให้ครบ');
    const reviewer=user.email,result=grade(exam,answers,b.reviews);
    const change=await stmt(env,"UPDATE attempts SET result_json=?, status=?, reviewed_at=?, reviewer=?, revision=revision+1 WHERE id=? AND revision=? AND status='pending_review'",JSON.stringify(result),result.status,Date.now(),reviewer,a.id,a.revision).run();
    requireValue(change.meta.changes,'มีผู้ประเมินยืนยันผลไปแล้ว',409);await audit(env,reviewer,'review_attempt',a.id);
    ctx.waitUntil(dispatchNotifications(env).catch(()=>{}));return json({ok:true,result});
  }
  if(path==='/api/admin/notifications/retry' && method==='POST') {
    const b=await body(request);requireValue(env.LARK_WEBHOOK_URL,'ยังไม่ได้เชื่อมต่อ Lark',503);
    await stmt(env,"UPDATE notifications SET tries=0,next_at=0 WHERE id=? AND state!='sent' AND lease_until < ?",text(b.id),Date.now()).run();
    ctx.waitUntil(dispatchNotifications(env).catch(()=>{}));return json({ok:true});
  }
  if(path==='/api/admin/export' && method==='GET') {
    const {results}=await env.DB.prepare('SELECT a.*,e.name,e.department FROM attempts a JOIN employees e ON e.id=a.employee_id ORDER BY a.started_at DESC').all();
    const rows=[['รหัสพนักงาน','ชื่อ','ฝ่าย','ข้อสอบ','ครั้งที่','สถานะ','คะแนน','เต็ม','เปอร์เซ็นต์','ผู้ประเมิน','เวลาส่ง (UTC)'],...results.map(a=>{const r=a.result_json?JSON.parse(a.result_json):{};return[a.employee_id,a.name,DEPARTMENTS[a.department],JSON.parse(a.snapshot_json).title,a.attempt_no,a.status,r.earned,r.total,r.percent,a.reviewer,a.submitted_at?new Date(a.submitted_at).toISOString():''];})];
    return new Response('\uFEFF'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n'),{headers:{'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="exam-results.csv"','cache-control':'no-store'}});
  }
  throw new HttpError(404,'ไม่พบรายการ');
}
export function createWorker(fetcher=(...args)=>fetch(...args)){return {
  async fetch(request,env,ctx) {
    let response;
    try {response=await route(request,env,ctx,fetcher);}catch(e){response=json({error:e instanceof HttpError?e.message:'ระบบขัดข้อง กรุณาลองอีกครั้ง'},e instanceof HttpError?e.status:500);}
    const out=new Response(response.body,response);
    out.headers.set('x-content-type-options','nosniff');out.headers.set('referrer-policy','same-origin');
    out.headers.set('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    out.headers.set('permissions-policy','camera=(), microphone=(), geolocation=()');
    if(new URL(request.url).protocol==='https:')out.headers.set('strict-transport-security','max-age=31536000');
    return out;
  },
  async scheduled(_event,env,ctx) {ctx.waitUntil((async()=>{await expireAttempts(env);await dispatchNotifications(env);await stmt(env,'DELETE FROM login_limits WHERE expires_at < ?',Date.now()).run();await stmt(env,'DELETE FROM email_challenges WHERE expires_at < ?',Date.now()).run();await stmt(env,'DELETE FROM oauth_states WHERE expires_at < ?',Date.now()).run();})());}
};}
export default createWorker();

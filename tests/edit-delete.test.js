import test from 'node:test';import assert from 'node:assert/strict';
import {fixture,prepareExam,startAndSubmit,examInput} from './helpers.js';

test('admin regrades a finalized result; pass/fail and certificate follow, reason is required and audited',async()=>{
 const f=fixture();const {examId,adminCookie}=await prepareExam(f,{mixed:false});const a=await startAndSubmit(f,examId,{q1:0});assert.equal(a.status,'failed');
 const empCookie=f.cookie;f.cookie=adminCookie;
 assert.equal((await f.request('/admin/attempts/'+a.id+'/regrade',{revision:a.revision,scores:{q1:{score:100}}})).status,400);
 assert.equal((await f.request('/admin/attempts/'+a.id+'/regrade',{revision:a.revision,reason:'เฉลยผิด',scores:{q1:{score:101}}})).status,400);
 const ok=await f.request('/admin/attempts/'+a.id+'/regrade',{revision:a.revision,reason:'เฉลยข้อ 1 ผิด',scores:{q1:{score:100}}});assert.equal(ok.status,200);assert.equal(ok.body.result.status,'passed');assert.equal(ok.body.result.percent,100);
 assert.equal((await f.request('/admin/attempts/'+a.id+'/regrade',{revision:a.revision,reason:'ซ้ำ',scores:{q1:{score:0}}})).status,409);
 const audit=await f.env.DB.prepare("SELECT target FROM audit_log WHERE action='regrade_attempt'").first();assert.match(audit.target,/0% failed → 100% passed \| เฉลยข้อ 1 ผิด/);
 f.cookie=empCookie;assert.equal((await f.request('/certificates/'+a.id)).status,200);assert.equal((await f.request('/attempts',{exam_id:examId})).status,409);
 f.cookie=adminCookie;const cur=(await f.request('/attempts/'+a.id)).body.attempt;
 const down=await f.request('/admin/attempts/'+a.id+'/regrade',{revision:cur.revision,reason:'ตรวจทานใหม่',scores:{q1:{score:94}}});assert.equal(down.body.result.status,'failed');
 f.cookie=empCookie;assert.equal((await f.request('/certificates/'+a.id)).status,404);assert.equal((await f.request('/attempts',{exam_id:examId})).body.attempt.attempt_no,2);
});

test('pending results cannot be regraded and employees/HR cannot edit or delete results',async()=>{
 const f=fixture();const {examId,adminCookie}=await prepareExam(f);const a=await startAndSubmit(f,examId);assert.equal(a.status,'pending_review');
 assert.equal((await f.request('/admin/attempts/'+a.id+'/delete',{reason:'x'})).status,403);
 f.cookie=adminCookie;assert.equal((await f.request('/admin/attempts/'+a.id+'/regrade',{revision:a.revision,reason:'x',scores:{q1:{score:60},q2:{score:40}}})).status,409);
 await f.request('/admin/hr',{name:'HR',email:'hr@company.test'});f.cookie='';await f.emailLogin('hr@company.test');
 assert.equal((await f.request('/admin/attempts/'+a.id+'/delete',{reason:'x'})).status,403);assert.equal((await f.request('/admin/exams/'+examId+'/update',examInput())).status,403);
});

test('deleting a result removes it with its notifications and gives the attempt back',async()=>{
 const f=fixture();const {examId,adminCookie}=await prepareExam(f,{mixed:false});const a=await startAndSubmit(f,examId,{q1:1});assert.equal(a.status,'passed');const empCookie=f.cookie;
 f.cookie=adminCookie;assert.equal((await f.request('/admin/attempts/'+a.id+'/delete',{})).status,400);
 assert.equal((await f.request('/admin/attempts/'+a.id+'/delete',{reason:'สอบผิดชุด'})).status,200);
 assert.equal((await f.env.DB.prepare('SELECT count(*) AS n FROM attempts').first()).n,0);assert.equal((await f.env.DB.prepare('SELECT count(*) AS n FROM notifications').first()).n,0);
 assert.match((await f.env.DB.prepare("SELECT target FROM audit_log WHERE action='delete_attempt'").first()).target,/SX-001 .* passed \| สอบผิดชุด/);
 f.cookie=empCookie;assert.equal((await f.request('/certificates/'+a.id)).status,404);const again=await f.request('/attempts',{exam_id:examId});assert.equal(again.status,201);assert.equal(again.body.attempt.attempt_no,1);
});

test('editing an exam changes future attempts only; past attempts keep their snapshot',async()=>{
 const f=fixture();const {examId,adminCookie}=await prepareExam(f,{mixed:false});const a=await startAndSubmit(f,examId,{q1:1});
 f.cookie=adminCookie;const changed={...examInput('technical',false),title:'ชุดแก้ไขแล้ว',title_en:'Edited Exam'};changed.questions[0].prompt='คำถามใหม่';
 assert.equal((await f.request('/admin/exams/'+examId+'/update',changed)).status,200);
 const row=await f.env.DB.prepare('SELECT title,title_en,questions_json FROM exams WHERE id=?').bind(examId).first();assert.equal(row.title,'ชุดแก้ไขแล้ว');assert.equal(row.title_en,'Edited Exam');assert.match(row.questions_json,/คำถามใหม่/);
 const past=(await f.request('/attempts/'+a.id)).body.attempt;assert.equal(past.exam.title,'การประเมินทักษะ');assert.equal(past.exam.questions[0].prompt,'ข้อเลือกตอบ');
 assert.equal((await f.request('/admin/exams/'+examId+'/update',{...changed,pass_percent:80})).status,400);
});

test('exam delete is permanent without results and archives (hides, closes) when results exist',async()=>{
 const f=fixture();await f.admin();const draft=(await f.request('/admin/exams',examInput())).body.id;
 const del=await f.request('/admin/exams/'+draft+'/delete',{});assert.equal(del.body.deleted,true);assert.equal(await f.env.DB.prepare('SELECT id FROM exams WHERE id=?').bind(draft).first(),null);
 const g=fixture();const {examId,adminCookie}=await prepareExam(g,{mixed:false});const a=await startAndSubmit(g,examId,{q1:1});const emp=g.cookie;g.cookie=adminCookie;
 const arc=await g.request('/admin/exams/'+examId+'/delete',{});assert.equal(arc.body.archived,true);
 assert.equal((await g.request('/admin/overview')).body.exams.length,0);assert.equal((await g.request('/admin/exams/'+examId+'/publish',{published:true})).status,404);assert.equal((await g.request('/admin/exams/'+examId+'/update',examInput())).status,404);
 assert.equal((await g.request('/reports/results')).body.attempts.length,1);g.cookie=emp;assert.equal((await g.request('/exams')).body.exams.length,0);assert.equal((await g.request('/certificates/'+a.id)).status,200);
});

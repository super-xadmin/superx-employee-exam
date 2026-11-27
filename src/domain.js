export const DEPARTMENTS = { technical: 'ฝ่ายเทคนิค', installation: 'ฝ่ายติดตั้ง', sales: 'ฝ่ายขาย' };
export const DEPARTMENTS_EN = { technical: 'Technical Department', installation: 'Installation Department', sales: 'Sales Department' };
export function optionalText(value, max = 200) { if (value == null || (typeof value === 'string' && !value.trim())) return null; return text(value, max); }
export function certificateNumber(attempt) { return 'SXA-' + new Date(attempt.reviewed_at || attempt.submitted_at).getUTCFullYear() + '-' + String(attempt.id).replace(/-/g, '').slice(0, 8).toUpperCase(); }
export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
export function requireValue(ok, message, status = 400) { if (!ok) throw new HttpError(status, message); }
export function text(value, max = 200) { requireValue(typeof value === 'string' && value.trim().length > 0 && value.length <= max, 'ข้อมูลไม่ครบหรือยาวเกินกำหนด'); return value.trim(); }
export function validateExam(input) {
  const title = text(input.title); requireValue(typeof input.department === 'string' && Object.hasOwn(DEPARTMENTS,input.department), 'กรุณาเลือกฝ่าย');
  requireValue(Number.isInteger(input.duration_minutes) && input.duration_minutes >= 1 && input.duration_minutes <= 180, 'เวลาสอบต้องอยู่ระหว่าง 1–180 นาที');
  requireValue(input.pass_percent === 95, 'เกณฑ์ผ่านของบริษัทคือ 95%');
  requireValue(Array.isArray(input.questions) && input.questions.length > 0 && input.questions.length <= 50, 'ข้อสอบต้องมี 1–50 ข้อ');
  const questions = input.questions.map((q, i) => {
    requireValue(['mcq', 'essay'].includes(q.type), 'ประเภทคำถามไม่ถูกต้อง');
    requireValue(Number.isFinite(q.points) && q.points > 0 && q.points <= 100, 'คะแนนต่อข้อต้องมากกว่า 0 และไม่เกิน 100');
    const out = { id: `q${i + 1}`, type: q.type, prompt: text(q.prompt, 3000), topic: text(q.topic || 'ความรู้ทั่วไป', 100), points: q.points };
    if (q.type === 'mcq') {
      requireValue(Array.isArray(q.options) && q.options.length >= 2 && q.options.length <= 6, 'ตัวเลือกต้องมี 2–6 ตัวเลือก');
      out.options = q.options.map(o => text(o, 1000));
      requireValue(Number.isInteger(q.correct) && q.correct >= 0 && q.correct < out.options.length, 'กรุณาระบุเฉลยที่ถูกต้อง');
      out.correct = q.correct; out.explanation = typeof q.explanation === 'string' ? q.explanation.slice(0, 2000) : '';
    } else {
      out.rubric = text(q.rubric, 3000);
      requireValue(Array.isArray(q.keywords) && q.keywords.length <= 20, 'คำสำคัญไม่ถูกต้อง');
      out.keywords = q.keywords.map(k => text(k, 100));
    }
    return out;
  });
  return { title, title_en: optionalText(input.title_en), department: input.department, duration_minutes: input.duration_minutes, pass_percent: input.pass_percent, questions };
}
export function publicExam(exam) {
  return { id: exam.id, title: exam.title, department: exam.department, duration_minutes: exam.duration_minutes, pass_percent: exam.pass_percent,
    questions: exam.questions.map(({id, type, prompt, topic, points, options}) => ({id, type, prompt, topic, points, ...(options ? {options} : {})})) };
}
export function normalizeAnswers(exam, answers) {
  requireValue(answers && typeof answers === 'object' && !Array.isArray(answers), 'คำตอบไม่ถูกต้อง');
  return Object.fromEntries(exam.questions.map(q => {
    const v = answers[q.id];
    if (q.type === 'mcq') { requireValue(v == null || (Number.isInteger(v) && v >= 0 && v < q.options.length), 'คำตอบตัวเลือกไม่ถูกต้อง'); return [q.id, v ?? null]; }
    requireValue(v == null || (typeof v === 'string' && v.length <= 6000), 'คำตอบข้อเขียนยาวเกิน 6,000 ตัวอักษร'); return [q.id, (v || '').trim()];
  }));
}
export function grade(exam, answers, reviews = null) {
  const questions = exam.questions.map(q => {
    if (q.type === 'mcq') return { id: q.id, topic: q.topic, max: q.points, score: answers[q.id] === q.correct ? q.points : 0, feedback: q.explanation || '' };
    if (!reviews) return { id: q.id, topic: q.topic, max: q.points, score: null, feedback: '' };
    const r = reviews[q.id];
    requireValue(r && Number.isFinite(r.score) && r.score >= 0 && r.score <= q.points, `คะแนน ${q.id} ต้องอยู่ระหว่าง 0–${q.points}`);
    return { id: q.id, topic: q.topic, max: q.points, score: r.score, feedback: text(r.feedback, 2000) };
  });
  const total = questions.reduce((s, q) => s + q.max, 0), earned = questions.reduce((s, q) => s + (q.score ?? 0), 0);
  const pending = questions.some(q => q.score === null), rawPercent = earned / total * 100;
  const percent = Math.floor(rawPercent * 100) / 100;
  return { questions, total, earned, percent, pass_percent: exam.pass_percent, status: pending ? 'pending_review' : rawPercent >= exam.pass_percent ? 'passed' : 'failed' };
}
// แก้คะแนนผลสอบที่สรุปแล้ว: ผู้ประเมินกำหนดคะแนนได้ทุกข้อ แล้วคำนวณผ่าน/ไม่ผ่านใหม่ตามเกณฑ์ของข้อสอบ
export function regrade(exam, scores) {
  requireValue(scores && typeof scores === 'object' && !Array.isArray(scores), 'กรุณาระบุคะแนนให้ครบทุกข้อ');
  const questions = exam.questions.map(q => {
    const r = scores[q.id];
    requireValue(r && Number.isFinite(r.score) && r.score >= 0 && r.score <= q.points, `คะแนน ${q.id} ต้องอยู่ระหว่าง 0–${q.points}`);
    const feedback = typeof r.feedback === 'string' && r.feedback.trim() ? r.feedback.trim().slice(0, 2000) : (q.type === 'mcq' ? (q.explanation || '') : '');
    return { id: q.id, topic: q.topic, max: q.points, score: r.score, feedback };
  });
  const total = questions.reduce((s, q) => s + q.max, 0), earned = questions.reduce((s, q) => s + q.score, 0), rawPercent = earned / total * 100;
  return { questions, total, earned, percent: Math.floor(rawPercent * 100) / 100, pass_percent: exam.pass_percent, status: rawPercent >= exam.pass_percent ? 'passed' : 'failed' };
}
export function rubricAnalysis(exam, answers) {
  return { source: 'rubric', notice: 'ตรวจหาคำสำคัญเพื่อช่วยผู้ประเมิน ไม่ใช่คะแนนและไม่ยืนยันความถูกต้องของคำตอบ', questions: exam.questions.filter(q => q.type === 'essay').map(q => {
    const answer = String(answers[q.id] || '').normalize('NFKC').toLocaleLowerCase('th');
    return { id: q.id, found: q.keywords.filter(k => answer.includes(k.normalize('NFKC').toLocaleLowerCase('th'))), missing: q.keywords.filter(k => !answer.includes(k.normalize('NFKC').toLocaleLowerCase('th'))), blank: !answer.trim(), rubric: q.rubric };
  }) };
}
export function csvCell(v) { let s = String(v ?? ''); if (/^[\s]*[=+@-]/u.test(s)) s = "'" + s; return '"' + s.replaceAll('"', '""') + '"'; }

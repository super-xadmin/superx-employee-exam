// Deploy ขึ้น Cloudflare ในคำสั่งเดียว ใช้ได้ทั้ง GitHub Actions, Cloudflare Workers Builds และเครื่องตัวเอง
// 1) หา ID ฐานข้อมูล D1 (จาก env D1_DATABASE_ID → wrangler.jsonc → ค้นตามชื่อ → สร้างใหม่ถ้ายังไม่มี)
// 2) ใส่ ID ลง wrangler.jsonc  3) ทำ migration  4) deploy Worker
// ใช้ --prepare-only เพื่อทำแค่ข้อ 1–2
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const CONFIG = 'wrangler.jsonc';
const PLACEHOLDER = '00000000-0000-0000-0000-000000000000';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WRANGLER = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const prepareOnly = process.argv.includes('--prepare-only');

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

function step(message) {
  console.log(`\n▶ ${message}`);
}

function wrangler(args, {capture = false} = {}) {
  if (!existsSync(WRANGLER)) fail('ไม่พบ wrangler ให้รัน npm ci ก่อน');
  const result = spawnSync(process.execPath, [WRANGLER, ...args], {
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    encoding: 'utf8',
  });
  if (result.error) fail(`เรียก wrangler ไม่ได้: ${result.error.message}`);
  if (result.status !== 0) fail(`คำสั่ง "wrangler ${args.join(' ')}" ล้มเหลว ดูสาเหตุจากข้อความด้านบน`);
  return result.stdout || '';
}

function listDatabases() {
  const out = wrangler(['d1', 'list', '--json'], {capture: true});
  const start = out.indexOf('[');
  const end = out.lastIndexOf(']');
  if (start < 0 || end < start) fail('อ่านรายชื่อฐานข้อมูล D1 จาก Cloudflare ไม่ได้');
  return JSON.parse(out.slice(start, end + 1));
}

function findDatabase(name) {
  const found = listDatabases().find((item) => item.name === name);
  return found ? (found.uuid || found.database_id || found.id) : '';
}

// ตรวจค่าที่ GitHub Actions ต้องมี ให้ error อ่านเข้าใจง่าย
if (process.env.GITHUB_ACTIONS === 'true') {
  const missing = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'].filter((key) => !process.env[key]);
  if (missing.length && !prepareOnly) {
    fail(`ยังไม่ได้ตั้ง GitHub Secret: ${missing.join(', ')}\n  ไปที่ GitHub → Settings → Secrets and variables → Actions → New repository secret`);
  }
}

const original = readFileSync(CONFIG, 'utf8');
let config;
try {
  config = JSON.parse(original.replace(/^\s*\/\/.*$/gm, ''));
} catch (error) {
  fail(`อ่าน ${CONFIG} ไม่ได้: ${error.message}`);
}
const db = config.d1_databases?.[0];
if (!db?.database_name || !db?.binding) fail(`ไม่พบ d1_databases ใน ${CONFIG}`);

step(`ตรวจฐานข้อมูล D1 "${db.database_name}"`);
let id = (process.env.D1_DATABASE_ID || '').trim();
if (id && (!UUID.test(id) || id === PLACEHOLDER)) {
  fail('ค่า D1_DATABASE_ID ไม่ถูกต้อง ต้องเป็น UUID จริงจาก Cloudflare หรือลบตัวแปรนี้ทิ้งเพื่อให้ระบบหาเอง');
}
if (!id && UUID.test(db.database_id || '') && db.database_id !== PLACEHOLDER) id = db.database_id;
if (!id) {
  id = findDatabase(db.database_name);
  if (id) {
    console.log(`  พบฐานข้อมูลเดิม: ${id}`);
  } else {
    console.log('  ยังไม่มีฐานข้อมูล กำลังสร้างใหม่ (Asia Pacific)');
    wrangler(['d1', 'create', db.database_name, '--location', 'apac', '--no-update-config']);
    id = findDatabase(db.database_name);
    if (!id) fail('สร้างฐานข้อมูลแล้วแต่หา ID ไม่เจอ ลองรันใหม่อีกครั้ง');
    console.log(`  สร้างแล้ว: ${id}`);
  }
}

// เขียนเฉพาะ database_id กลับไป โดยรักษารูปแบบไฟล์เดิม
const updated = original.replace(/("database_id"\s*:\s*")[^"]*(")/, `$1${id}$2`);
if (updated !== original) {
  writeFileSync(CONFIG, updated);
  console.log(`  อัปเดต ${CONFIG} แล้ว`);
} else {
  writeFileSync(CONFIG, original); // คืนไฟล์เดิม เผื่อ wrangler แก้ไฟล์ระหว่างสร้างฐานข้อมูล
}

if (prepareOnly) process.exit(0);

step('ทำ migration ฐานข้อมูล');
wrangler(['d1', 'migrations', 'apply', db.binding, '--remote']);

step('Deploy Worker');
wrangler(['deploy']);

console.log('\n✔ Deploy สำเร็จ อย่าลืมตั้ง Secret ของแอป (SESSION_SECRET ฯลฯ) ด้วย npx wrangler secret put <ชื่อ> ถ้ายังไม่ได้ตั้ง\n');

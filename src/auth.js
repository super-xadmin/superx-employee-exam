import { HttpError } from './domain.js';
const enc = new TextEncoder();
export const randomCode = () => Array.from(crypto.getRandomValues(new Uint8Array(18)), n => n.toString(16).padStart(2, '0')).join('');
export async function hash(s) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s))), n => n.toString(16).padStart(2, '0')).join(''); }
async function key(secret) { return crypto.subtle.importKey('raw', enc.encode(secret), {name:'HMAC', hash:'SHA-256'}, false, ['sign', 'verify']); }
const b64 = data => btoa(String.fromCharCode(...new Uint8Array(data)));
const from64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export async function secureEqual(a, b) {
  const k = await key('constant-time-comparison-key');
  return crypto.subtle.verify('HMAC', k, await crypto.subtle.sign('HMAC', k, enc.encode(a)), enc.encode(b));
}
export async function sessionToken(payload, secret) {
  const data = b64(enc.encode(JSON.stringify({...payload, exp: Date.now() + 8 * 3600_000}))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
  const signature = b64(await crypto.subtle.sign('HMAC', await key(secret), enc.encode(data)));
  return `${data}.${signature}`;
}
export async function readSession(request, env) {
  const token = request.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith('exam_session='))?.slice(13);
  if (!token || !env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new HttpError(401, 'กรุณาเข้าสู่ระบบ');
  try {
    const [data, sig, extra] = token.split('.');
    if (extra || !data || !sig || !await crypto.subtle.verify('HMAC', await key(env.SESSION_SECRET), from64(sig), enc.encode(data))) throw new Error();
    const s = JSON.parse(new TextDecoder().decode(from64(data.replaceAll('-','+').replaceAll('_','/'))));
    if (!Number.isFinite(s.exp) || s.exp <= Date.now() || !['admin','employee'].includes(s.role)) throw new Error();
    if (!['email','lark'].includes(s.auth_method) || typeof s.email!=='string') throw new Error();
    if (s.role === 'admin') {
      if (!String(env.ADMIN_EMAILS||'').split(',').map(x=>x.trim().toLowerCase()).includes(s.email)) throw new Error();
      if(s.auth_method==='lark'){
        let bindings;try{bindings=JSON.parse(env.LARK_ADMIN_BINDINGS||'{}');}catch{throw new Error();}
        if(s.lark_tenant_key!==env.LARK_TENANT_KEY || !s.lark_open_id || bindings[s.lark_open_id]!==s.email)throw new Error();
      }
      return s;
    }
    if (s.role === 'employee') {
      const e = await env.DB.prepare('SELECT id, name, email, department, auth_version, lark_open_id, lark_tenant_key FROM employees WHERE id = ? AND active = 1').bind(s.id).first();
      if (!e || e.auth_version !== s.version || e.email !== s.email) throw new Error();
      if(s.auth_method==='lark' && (e.lark_open_id!==s.lark_open_id || e.lark_tenant_key!==env.LARK_TENANT_KEY || e.lark_tenant_key!==s.lark_tenant_key))throw new Error();
      return {...s, ...e};
    }
    return s;
  } catch { throw new HttpError(401, 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่'); }
}
export function cookie(token, request, clear = false) { return `exam_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : 28800}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`; }
export async function larkSignature(timestamp, secret) { return b64(await crypto.subtle.sign('HMAC', await key(`${timestamp}\n${secret}`), new Uint8Array())); }

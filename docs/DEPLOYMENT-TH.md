# ติดตั้งระบบอีเมล / Lark บน Cloudflare

## ตั้งค่าเว็บและฐานข้อมูล

1. ติดตั้ง Node.js 24 LTS เปิดโฟลเดอร์และ `npm ci`
2. `npx wrangler login`
3. ตั้งค่าตามตารางและเปิดอย่างน้อยหนึ่งช่องทางยืนยันตัวตน
4. `npm run deploy` คำสั่งเดียวจะหาฐานข้อมูล D1 `employee-assessments` (หรือสร้างให้ถ้ายังไม่มี) ใส่ ID ลง `wrangler.jsonc` ทำ migration ทั้งหมด (0001–0003) แล้ว deploy Worker ไม่ต้องคัดลอก ID เอง

## ค่าตั้งค่า

| ค่า | ที่เก็บ | ใช้สำหรับ |
| --- | --- | --- |
| `SESSION_SECRET` | Secret | สุ่มอย่างน้อย 32 ตัวอักษร สำหรับเซสชันและ OTP hash |
| `ADMIN_EMAILS` | vars | ผู้ประเมินที่อนุญาต คั่นด้วย comma ค่าเริ่มต้น `phop@super-x.tech` |
| `EMAIL_FROM` | vars | ผู้ส่งที่ยืนยันโดเมนกับ Resend แล้ว |
| `RESEND_API_KEY` | Secret | ส่ง OTP ผ่าน Resend |
| `LARK_APP_ID` | vars | App ID สำหรับ Lark Login |
| `LARK_APP_SECRET` | Secret | App Secret สำหรับ Lark Login |
| `LARK_TENANT_KEY` | vars | องค์กร Lark ที่อนุญาต ต้องตรงกับ user_info |
| `LARK_LOGIN_SCOPES` | vars (ถ้าปรับ) | scopes เพิ่มเติม ถ้าจำเป็น ค่าเริ่มต้นไม่ขอสิทธิ์อ่านอีเมล |
| `LARK_EMAIL_DOMAIN` | vars | เปิดการจับคู่บัญชี Lark กับพนักงานอัตโนมัติ เมื่ออีเมลในโปรไฟล์ Lark (โดเมนนี้ เช่น `super-x.tech`) ตรงกับพนักงานที่ยังไม่ผูก Lark ใช้กับพนักงานเท่านั้น ต้องขอสิทธิ์ `contact:user.email:readonly` และตั้ง `LARK_LOGIN_SCOPES` |
| `LARK_ADMIN_BINDINGS` | vars | JSON string ผูก Open ID ของผู้ประเมินกับอีเมลที่อยู่ใน ADMIN_EMAILS |
| `APP_URL` | vars | URL จริง เช่น `https://academy.super-x.tech` |
| `COMPANY_NAME` | vars | ชื่อบนเว็บ |
| `LARK_WEBHOOK_URL` | Secret | Custom Bot สำหรับแจ้งผลสอบ |
| `LARK_SIGNING_SECRET` | Secret | ลายเซ็นของ Custom Bot เมื่อเปิดใช้ |
| `AI_ENABLED` | vars | ค่าเริ่มต้น `"false"` |
| `AI_MODEL` | vars | โมเดลสำหรับตัวช่วยวิเคราะห์ |

ตั้ง Secret ผ่าน `npx wrangler secret put ชื่อค่า` และกรอกตามคำแนะนำ ห้ามวาง Secret ใน `wrangler.jsonc` หรือ GitHub สำหรับเครื่องทดลองให้ใช้ `.dev.vars` ที่ถูกกันออกจาก Git แล้ว

## อีเมล OTP

1. สร้าง API key ใน Resend และยืนยันโดเมนผู้ส่ง `super-x.tech` ตาม DNS ที่ Resend ระบุ
2. ตั้ง `EMAIL_FROM` ให้ตรงโดเมนที่ยืนยัน และเก็บ `RESEND_API_KEY` เป็น Secret
3. สร้าง `SESSION_SECRET` แยกสำหรับระบบจริงและเครื่องทดลอง
4. Deploy แล้วกรอก `phop@super-x.tech` เพื่อรับ OTP ในกล่องจดหมายจริง
5. ระบบส่งเฉพาะอีเมลที่ได้รับสิทธิ์ และแสดงข้อความเหมือนกันไม่ว่าอีเมลมีรายชื่อหรือไม่
6. รหัสใช้ครั้งเดียวภายใน 10 นาที ลองผิดได้ไม่เกิน 5 ครั้งต่อรหัส จำกัดขอรหัส 5 ครั้งต่ออีเมลต่อช่วงชั่วโมง
7. หากส่งไม่สำเร็จ ผู้ที่ยังไม่เข้าสู่ระบบจะไม่เห็นรายละเอียดจากผู้ให้บริการ ผู้ดูแลตรวจ `email_delivery_failed` ใน audit log/D1 และการตั้งค่าที่ Resend ได้

ระบบไม่มี API อ่านรหัสจากเบราว์เซอร์ ไม่มีการพิมพ์รหัสลง log และไม่มีรหัสตายตัวสำหรับทดลอง

## Lark Login

1. สร้าง Enterprise Custom App ใน Lark Developer Console ไม่ใช่ Custom Bot
2. เปิด Web Login และกำหนด Redirect URL เป็น URL ที่ตรงทุกส่วน เช่น `https://academy.super-x.tech/api/auth/lark/callback`
3. อนุมัติ/เผยแพร่ Web Login ให้สมาชิกบริษัทตามขั้นตอนของ Lark ไม่ต้องใช้สิทธิ์อ่านอีเมลเพื่อจับคู่บัญชี
4. ตั้ง App ID, App Secret และ tenant key ของบริษัท ห้ามข้ามการตรวจ tenant key
5. ตั้ง `APP_URL` เป็น origin ที่ผู้ใช้เปิดเว็บจริง การเริ่มล็อกอินบนคนละโดเมนจะถูกปฏิเสธ
6. ผูกผู้ประเมินใน `LARK_ADMIN_BINDINGS` เช่น JSON string `{"ou_REAL_OPEN_ID":"phop@super-x.tech"}` โดยอีเมลปลายทางต้องอยู่ใน ADMIN_EMAILS ส่วนพนักงานให้ผู้ประเมินเข้าทาง OTP แล้วตั้ง Open ID ที่หน้า **พนักงาน → อีเมล / Lark**
7. รับ Open ID จากข้อมูลสมาชิกที่เชื่อถือได้ใน Lark ของแอปเดียวกัน ยืนยันกับเจ้าของบัญชีก่อนผูก ไม่รับ Open ID ที่พนักงานใส่เองผ่านหน้าล็อกอิน
8. ทดสอบทั้ง tenant key และ Open ID ให้ตรง ระบบไม่ยอมให้ข้อมูล email ใน user_info เพียงอย่างเดียวทำให้มีสิทธิ์ใช้งาน

API ที่ใช้งาน: `accounts.larksuite.com/open-apis/authen/v1/authorize`, `open.larksuite.com/open-apis/authen/v2/oauth/token`, และ `open.larksuite.com/open-apis/authen/v1/user_info` โค้ดนี้ตั้งค่าผู้ให้บริการเป็น Lark สากล ส่วนการแจ้งผล Bot รองรับทั้ง Lark/Feishu

## ผูกซับโดเมน super-x.tech

ตัวอย่าง `academy.super-x.tech` ยังไม่ได้สร้างจริง ให้เลือกชื่อก่อนแล้วไป Cloudflare Dashboard → Workers & Pages → Worker → Settings → Domains & Routes → Add → Custom Domain จากนั้นตั้ง `APP_URL` และ callback ใน Lark ให้ตรงกับโดเมนเดียวกัน ทดสอบ HTTPS และการกลับจาก Lark บนโดเมนจริง

## แจ้งผลผ่าน Custom Bot

สร้าง Custom Bot ในกลุ่มผู้ประเมิน เก็บ Webhook เป็น `LARK_WEBHOOK_URL` และ signing secret เป็น `LARK_SIGNING_SECRET` เมื่อเปิดตรวจลายเซ็น หากตั้งคำสำคัญให้ยอมรับข้อความที่มี `SuperX Academy`

ข้อเขียนส่งสถานะรอประเมินก่อน และส่งผลสุดท้ายเมื่อผู้ประเมินตรวจครบ Bot ไม่ต้องมีสิทธิ์ล็อกอิน ระบบลองส่งใหม่ผ่านคิว D1/Cron สูงสุด 10 ครั้งต่อเหตุการณ์ และมีปุ่มลองส่งซ้ำในหน้า **การเชื่อมต่อ** ข้อความอาจซ้ำเมื่อเครือข่ายขาดระหว่างยืนยันการส่ง ใช้รหัสผลสอบและรุ่นผลเทียบรายการ

## GitHub Actions

อัปโหลดโค้ดทั้งโฟลเดอร์โดยไม่รวมไฟล์ลับ ต้องมีโฟลเดอร์ `.github` และไฟล์ `package-lock.json` ด้วย (ถ้าลากวางผ่านหน้าเว็บ ไฟล์ที่ขึ้นต้นด้วยจุดมักหลุด) ตั้ง GitHub Actions Secrets:

- `CLOUDFLARE_API_TOKEN`: สิทธิ์ Workers Scripts:Edit และ D1:Edit ใน account ที่ใช้
- `CLOUDFLARE_ACCOUNT_ID`

Variable `D1_DATABASE_ID` ไม่บังคับแล้ว ถ้าไม่ตั้ง workflow จะหาฐานข้อมูลตามชื่อหรือสร้างให้เอง ตั้ง Secret ของแอปที่ Cloudflare ตามหัวข้อข้างต้น แล้วใช้ Actions → Deploy to Cloudflare → Run workflow บน main Workflow จะตรวจโค้ด หา/สร้าง D1 ทำ migration แล้ว deploy ไม่สร้าง Secret ของแอปให้เอง

## Cloudflare Workers Builds (เชื่อม Git จากหน้า Cloudflare)

ใช้ทางนี้หรือ GitHub Actions อย่างใดอย่างหนึ่ง ไม่ควรเปิดทั้งสองทาง

1. Cloudflare Dashboard → Workers & Pages → Create → **Workers** → Import a repository (ไม่ใช่ Pages)
2. ชื่อ Worker: `employee-assessment-hub` ให้ตรงกับ `wrangler.jsonc`
3. Build command: `npm run check`
4. Deploy command: `npm run deploy` (ห้ามใช้ `npx wrangler deploy` ตรง ๆ เพราะจะไม่ได้หา D1 และไม่ทำ migration)
5. Root directory: `/` และใช้ Node.js 22 ขึ้นไป
6. ตั้ง Secret ของแอปใน Worker → Settings → Variables and Secrets

## บัญชีฝ่าย HR และใบประกาศนียบัตร

- **บัญชี HR:** ผู้ประเมินเพิ่มได้ที่หน้า **พนักงาน → บัญชีฝ่าย HR** (ชื่อ + อีเมล) HR เข้าสู่ระบบด้วยรหัสยืนยันทางอีเมล หรือ Lark (จับคู่จากอีเมล @super-x.tech อัตโนมัติ) เห็นเฉพาะหน้า **ผลสอบพนักงาน** ดาวน์โหลด CSV และเปิดใบประกาศได้ แก้ไขข้อมูลหรือข้อสอบไม่ได้ ปิดสิทธิ์แล้วจะออกจากระบบทันที
- **สถานะสำหรับ HR:** ผ่าน · ไม่ผ่าน (หมดสิทธิ์สอบซ่อม) ใช้ประกอบการออกใบเตือน · ไม่ผ่านครั้งแรก (สอบซ่อมได้) · รอประเมิน · ยังไม่สอบ
- **ใบประกาศ (ภาษาอังกฤษ):** ออกให้อัตโนมัติเมื่อผลเป็น "ผ่าน" พนักงาน HR และผู้ประเมินเปิดได้ พิมพ์หรือบันทึกเป็น PDF ขนาด A4 แนวนอน มีเลขที่ใบประกาศ `SXA-ปี-รหัส` ใช้ชื่อภาษาอังกฤษของพนักงาน (ตั้งได้ที่ปุ่ม **ชื่ออังกฤษ**) และชื่อข้อสอบภาษาอังกฤษ (`title_en`) ถ้าไม่ได้ตั้งจะใช้ชื่อไทย/ชื่อฝ่ายแทน
- ต้องรัน migration `0004_hr_certificates.sql` ซึ่ง `npm run deploy` ทำให้อัตโนมัติ

## อัปเกรดจากรุ่นเก่า

- สำรอง D1 ก่อนด้วย `npx wrangler d1 export DB --remote --output=backup.sql`
- `npm run db:remote` แล้ว deploy เวอร์ชันนี้
- ทุกเซสชันแบบเก่า รหัสพนักงาน+รหัสเข้าสอบ และรหัสผ่านผู้ประเมินส่วนกลางจะใช้ไม่ได้
- ล็อกอินด้วย `phop@super-x.tech` แล้วเพิ่มอีเมลให้พนักงานเดิมผ่านปุ่มแก้ไขอีเมล ประวัติผลและจำนวนสิทธิ์สอบไม่เปลี่ยน
- `code_hash` ในตารางเดิมถูกล้างและเก็บคอลัมน์ไว้เพื่อรองรับ schema เดิมเท่านั้น ไม่มีการใช้เป็นช่องทางเข้าสู่ระบบ
- ลบ Secret `ADMIN_PASSWORD` เก่าที่ Cloudflare ได้

## แหล่งอ้างอิง

- [Cloudflare Workers](https://developers.cloudflare.com/workers/static-assets/)
- [Wrangler และ bindings](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Resend Official SDK และการยืนยันผู้ส่ง](https://github.com/resend/resend-node)
- [Lark Login Overview](https://open.larksuite.com/document/server-docs/getting-started/authen-v1/build-login-free-system-)
- [Lark OAuth Token](https://open.larksuite.com/document/uAjLw4CM/ukTMukTMukTM/authentication-management/access-token/refresh-user-access-token)
- [Lark Custom Bot](https://open.larksuite.com/document/uAjLw4CM/ukTMukTMukTM/bot-v3/use-custom-bots-in-a-group)

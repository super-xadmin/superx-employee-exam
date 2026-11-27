-- ชื่อภาษาอังกฤษสำหรับใบประกาศนียบัตร (ไม่บังคับ)
ALTER TABLE employees ADD COLUMN name_en TEXT;
ALTER TABLE exams ADD COLUMN title_en TEXT;
-- บัญชีฝ่าย HR: ดูผลสอบและใบประกาศได้อย่างเดียว ผู้ประเมินเพิ่ม/ปิดสิทธิ์ได้จากหน้าพนักงาน
CREATE TABLE hr_users (
 email TEXT PRIMARY KEY COLLATE NOCASE,
 name TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1,
 auth_version INTEGER NOT NULL DEFAULT 1,
 lark_open_id TEXT,
 lark_tenant_key TEXT,
 created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX hr_users_lark_unique ON hr_users(lark_tenant_key,lark_open_id) WHERE lark_open_id IS NOT NULL;
-- ชื่อภาษาอังกฤษของชุดข้อสอบมาตรฐานที่เพิ่มไว้ก่อนอัปเดตนี้
UPDATE exams SET title_en='Robovan Systems and Technical Operations SOP' WHERE id='superx-technical-v1' AND title_en IS NULL;
UPDATE exams SET title_en='Robovan Product Knowledge for Sales' WHERE id='superx-sales-v1' AND title_en IS NULL;
UPDATE exams SET title_en='Installation and Handover Standards' WHERE id='sample-installation' AND title_en IS NULL;

-- ชุดข้อสอบที่มีผลสอบแล้วจะถูก "ซ่อน" แทนการลบ เพื่อเก็บประวัติผลสอบไว้
ALTER TABLE exams ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;

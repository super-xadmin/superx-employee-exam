PRAGMA foreign_keys = ON;
CREATE TABLE employees (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  department TEXT NOT NULL CHECK(department IN ('technical','installation','sales')),
  code_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  auth_version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE exams (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  department TEXT NOT NULL CHECK(department IN ('technical','installation','sales')),
  duration_minutes INTEGER NOT NULL,
  pass_percent REAL NOT NULL,
  questions_json TEXT NOT NULL,
  published INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE attempts (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  exam_id TEXT NOT NULL REFERENCES exams(id),
  snapshot_json TEXT NOT NULL,
  answers_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT,
  analysis_json TEXT,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress','pending_review','passed','failed')),
  started_at INTEGER NOT NULL,
  deadline INTEGER NOT NULL,
  submitted_at INTEGER,
  reviewed_at INTEGER,
  reviewer TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  attempt_no INTEGER NOT NULL CHECK(attempt_no IN (1,2)),
  UNIQUE(employee_id, exam_id, attempt_no)
);
CREATE INDEX attempts_status ON attempts(status, submitted_at);
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES attempts(id),
  revision INTEGER NOT NULL,
  event_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  tries INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  sent_at INTEGER,
  UNIQUE(attempt_id, revision)
);
CREATE TABLE login_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL,
  target TEXT NOT NULL, created_at INTEGER NOT NULL
);

CREATE TRIGGER attempt_notification AFTER UPDATE ON attempts
WHEN NEW.status != 'in_progress' AND (OLD.status = 'in_progress' OR NEW.revision != OLD.revision)
BEGIN
 INSERT OR IGNORE INTO notifications(id, attempt_id, revision, event_json)
 VALUES(NEW.id || ':' || NEW.revision, NEW.id, NEW.revision,
 json_object('attempt_id',NEW.id,'attempt_no',NEW.attempt_no,'employee_id',NEW.employee_id,
 'name',(SELECT name FROM employees WHERE id=NEW.employee_id),
 'department',json_extract(NEW.snapshot_json,'$.department'),
 'title',json_extract(NEW.snapshot_json,'$.title'),'status',NEW.status,
 'result',json(NEW.result_json)));
END;

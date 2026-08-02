PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root TEXT NOT NULL UNIQUE,
  branch TEXT,
  remote TEXT,
  package_manager TEXT NOT NULL DEFAULT 'unknown',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workspace_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS job_history (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'complete', 'error')),
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  error TEXT,
  metadata TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS file_index (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  path TEXT NOT NULL,
  hash TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size >= 0),
  last_modified TEXT NOT NULL,
  indexed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (project_id, path),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS code_analysis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_index_id INTEGER NOT NULL UNIQUE,
  complexity REAL,
  lines INTEGER NOT NULL DEFAULT 0 CHECK (lines >= 0),
  functions INTEGER NOT NULL DEFAULT 0 CHECK (functions >= 0),
  classes INTEGER NOT NULL DEFAULT 0 CHECK (classes >= 0),
  imports TEXT NOT NULL DEFAULT '[]',
  exports TEXT NOT NULL DEFAULT '[]',
  security_risks TEXT NOT NULL DEFAULT '[]',
  performance_hints TEXT NOT NULL DEFAULT '[]',
  code_smells TEXT NOT NULL DEFAULT '[]',
  analyzed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (file_index_id) REFERENCES file_index(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_job_history_project ON job_history(project_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_history_status ON job_history(status);
CREATE INDEX IF NOT EXISTS idx_file_index_project ON file_index(project_id, path);
CREATE INDEX IF NOT EXISTS idx_file_index_hash ON file_index(hash);
CREATE INDEX IF NOT EXISTS idx_code_analysis_complexity ON code_analysis(complexity DESC);

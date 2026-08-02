import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { config } from 'dotenv';

config();

const directory = path.dirname(fileURLToPath(import.meta.url));
const databasePath = path.resolve(
  process.env.WORKSPACE_DB_PATH ?? path.join(directory, 'openbrowser-workspace.db'),
);
const schemaPath = path.join(directory, 'schema.sql');
const schemaOnly = process.argv.includes('--schema-only');

fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const database = new Database(databasePath);

database.pragma('foreign_keys = ON');
database.pragma('journal_mode = WAL');
database.exec(fs.readFileSync(schemaPath, 'utf8'));

if (!schemaOnly) {
  const root = path.resolve(process.env.OPENBROWSER_SEED_PROJECT_ROOT ?? process.cwd());
  const id = crypto.createHash('sha256').update(root).digest('hex').slice(0, 24);
  const name = process.env.OPENBROWSER_SEED_PROJECT_NAME ?? path.basename(root);

  database.prepare(`
    INSERT INTO projects (id, name, root, branch, remote, package_manager)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(root) DO UPDATE SET
      name = excluded.name,
      updated_at = CURRENT_TIMESTAMP
  `).run(id, name, root, 'unknown', 'unknown', 'unknown');

  database.prepare(`
    INSERT INTO workspace_settings (key, value)
    VALUES ('active_project_id', ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = CURRENT_TIMESTAMP
  `).run(id);

  console.log(`Seeded workspace project ${name} (${id})`);
}

const quickCheck = database.pragma('quick_check', { simple: true });
database.close();

if (quickCheck !== 'ok') {
  throw new Error(`SQLite quick_check failed: ${String(quickCheck)}`);
}

console.log(`Workspace database ready at ${databasePath}`);

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { closeDatabase, connectDatabase, createIndexes } from '../src/db.js';

const sqlitePath = path.resolve(process.env.SQLITE_DATABASE_PATH || './data/cloudops.db');
if (!fs.existsSync(sqlitePath)) throw new Error(`SQLite database was not found: ${sqlitePath}`);
const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
const db = await connectDatabase();
await createIndexes(db);
const mappings = [
  ['services', 'services', (row) => ({ legacyId: row.id, name: row.name, description: row.description, owner: row.owner, url: row.url, status: row.status, created_at: row.created_at, updated_at: row.updated_at })],
  ['health_checks', 'healthChecks', (row) => ({ legacyId: row.id, serviceId: row.service_id, status: row.status, responseTime: row.response_time, message: row.message, checked_at: row.checked_at })],
  ['deployments', 'deployments', (row) => ({ legacyId: row.id, serviceId: row.service_id, version: row.version, environment: row.environment, status: row.status, notes: row.notes, deployed_at: row.deployed_at })],
  ['incidents', 'incidents', (row) => ({ legacyId: row.id, serviceId: row.service_id, title: row.title, description: row.description, severity: row.severity, status: row.status, created_at: row.created_at, resolved_at: row.resolved_at })],
];
try {
  for (const [source, target, transform] of mappings) {
    const rows = sqlite.prepare(`SELECT * FROM ${source}`).all();
    if (rows.length) await db.collection(target).bulkWrite(rows.map((row) => ({ updateOne: { filter: { legacyId: row.id }, update: { $set: transform(row) }, upsert: true } })));
    console.log(`${source}: migrated ${rows.length} SQLite row(s); MongoDB collection has ${await db.collection(target).countDocuments()} record(s).`);
  }
  for (const [source, target] of mappings) {
    const highest = sqlite.prepare(`SELECT MAX(id) AS id FROM ${source}`).get().id || 0;
    await db.collection('counters').updateOne({ _id: target }, { $max: { value: highest } }, { upsert: true });
  }
} finally { sqlite.close(); await closeDatabase(); }

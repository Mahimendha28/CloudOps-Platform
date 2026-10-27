import { MongoClient } from 'mongodb';

let client;
let database;

function configuration() {
  const uri = process.env.MONGODB_URI;
  const databaseName = process.env.MONGODB_DB;
  if (!uri) throw new Error('MONGODB_URI must be configured.');
  if (!databaseName) throw new Error('MONGODB_DB must be configured.');
  return { uri, databaseName };
}

export async function connectDatabase() {
  if (database) return database;
  const { uri, databaseName } = configuration();
  client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  database = client.db(databaseName);
  await database.command({ ping: 1 });
  await createIndexes(database);
  return database;
}

export function getDatabase() {
  if (!database) throw Object.assign(new Error('Database is not connected.'), { status: 503 });
  return database;
}

export async function databaseReady() {
  if (!database) return false;
  try { await database.command({ ping: 1 }); return true; } catch { return false; }
}

export async function closeDatabase() {
  if (client) await client.close();
  client = undefined;
  database = undefined;
}

export async function createIndexes(db) {
  const specs = [
    ['services', [{ key: { legacyId: 1 }, unique: true, partialFilterExpression: { legacyId: { $exists: true } } }, { key: { owner: 1, created_at: -1 } }]],
    ['healthChecks', [{ key: { legacyId: 1 }, unique: true, partialFilterExpression: { legacyId: { $exists: true } } }, { key: { serviceId: 1, checked_at: -1 } }]],
    ['deployments', [{ key: { legacyId: 1 }, unique: true, partialFilterExpression: { legacyId: { $exists: true } } }, { key: { serviceId: 1, deployed_at: -1 } }]],
    ['incidents', [{ key: { legacyId: 1 }, unique: true, partialFilterExpression: { legacyId: { $exists: true } } }, { key: { status: 1, created_at: -1 } }]],
  ];
  await Promise.all(specs.map(async ([collectionName, indexes]) => {
    const collection = db.collection(collectionName);
    let existing = [];
    try { existing = await collection.indexes(); } catch (error) { if (error.code !== 26) throw error; }
    const missing = indexes.filter((index) => !existing.some((current) => JSON.stringify(current.key) === JSON.stringify(index.key)));
    if (missing.length) await collection.createIndexes(missing);
  }));
}

export async function nextLegacyId(collectionName) {
  const counter = await getDatabase().collection('counters').findOneAndUpdate(
    { _id: collectionName }, { $inc: { value: 1 } }, { upsert: true, returnDocument: 'after', includeResultMetadata: false },
  );
  return counter.value;
}

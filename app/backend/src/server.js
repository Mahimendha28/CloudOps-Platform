import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import {
  connectDatabase,
  closeDatabase,
  getDatabase,
  databaseReady,
  nextLegacyId,
} from './db.js';

dotenv.config();
const app = express();
const port = Number(process.env.PORT || 3001);

const allowedOrigins = (process.env.FRONTEND_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

const statuses = ['healthy', 'degraded', 'unhealthy'];
const required = (value, label) => { if (typeof value !== 'string' || !value.trim()) throw Object.assign(new Error(`${label} is required.`), { status: 400 }); };
const id = (value, label = 'ID') => { const parsed = Number(value); if (!Number.isInteger(parsed) || parsed < 1) throw Object.assign(new Error(`${label} must be a positive integer.`), { status: 400 }); return parsed; };
const now = () => new Date().toISOString();
const serviceToApi = (service) => service && ({ id: service.legacyId, name: service.name, description: service.description, owner: service.owner, url: service.url, status: service.status, created_at: service.created_at, updated_at: service.updated_at });
const healthToApi = (check, serviceName) => ({ id: check.legacyId, service_id: check.serviceId, status: check.status, response_time: check.responseTime, message: check.message, checked_at: check.checked_at, service_name: serviceName ?? check.service_name ?? null });
const deploymentToApi = (deployment, serviceName) => ({ id: deployment.legacyId, service_id: deployment.serviceId, version: deployment.version, environment: deployment.environment, status: deployment.status, notes: deployment.notes, deployed_at: deployment.deployed_at, service_name: serviceName ?? deployment.service_name ?? null });
const incidentToApi = (incident, serviceName) => ({ id: incident.legacyId, service_id: incident.serviceId ?? null, title: incident.title, description: incident.description, severity: incident.severity, status: incident.status, created_at: incident.created_at, resolved_at: incident.resolved_at ?? null, service_name: serviceName ?? incident.service_name ?? null });
async function serviceExists(value) { const service = await getDatabase().collection('services').findOne({ legacyId: id(value, 'Service ID') }); if (!service) throw Object.assign(new Error('Service not found.'), { status: 404 }); return service; }
function validateService(body) { required(body.name, 'Name'); required(body.owner, 'Owner'); required(body.url, 'URL'); try { new URL(body.url); } catch { throw Object.assign(new Error('URL must be valid.'), { status: 400 }); } if (body.status && !statuses.includes(body.status)) throw Object.assign(new Error('Invalid service status.'), { status: 400 }); }

app.get('/health', async (_req, res) => { const ready = await databaseReady(); res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'unavailable', database: ready ? 'connected' : 'unavailable', timestamp: new Date().toISOString() }); });
app.get('/ready', async (_req, res) => { const ready = await databaseReady(); res.status(ready ? 200 : 503).json({ ready }); });
app.get('/api/dashboard', async (_req, res) => { const db = getDatabase(); const managed = { legacyId: { $exists: true } }; const [services, healthyServices, unhealthyServices, deployments, openIncidents] = await Promise.all([db.collection('services').countDocuments(managed), db.collection('services').countDocuments({ ...managed, status: 'healthy' }), db.collection('services').countDocuments({ ...managed, status: { $ne: 'healthy' } }), db.collection('deployments').countDocuments(managed), db.collection('incidents').countDocuments({ ...managed, status: 'open' })]); res.json({ services, healthyServices, unhealthyServices, deployments, openIncidents }); });

app.get('/api/services', async (req, res) => { const search = String(req.query.search || '').trim(); const filter = search ? { legacyId: { $exists: true }, $or: [{ name: { $regex: search, $options: 'i' } }, { owner: { $regex: search, $options: 'i' } }] } : { legacyId: { $exists: true } }; const services = await getDatabase().collection('services').find(filter).sort({ created_at: -1 }).toArray(); res.json(services.map(serviceToApi)); });
app.post('/api/services', async (req, res) => { validateService(req.body); const { name, description = '', owner, url, status = 'healthy' } = req.body; const timestamp = now(); const service = { legacyId: await nextLegacyId('services'), name: name.trim(), description: description.trim(), owner: owner.trim(), url: url.trim(), status, created_at: timestamp, updated_at: timestamp }; await getDatabase().collection('services').insertOne(service); res.status(201).json(serviceToApi(service)); });
app.put('/api/services/:id', async (req, res) => { validateService(req.body); const serviceId = id(req.params.id); const { name, description = '', owner, url, status = 'healthy' } = req.body; const update = { name: name.trim(), description: description.trim(), owner: owner.trim(), url: url.trim(), status, updated_at: now() }; const result = await getDatabase().collection('services').findOneAndUpdate({ legacyId: serviceId }, { $set: update }, { returnDocument: 'after', includeResultMetadata: false }); if (!result) throw Object.assign(new Error('Service not found.'), { status: 404 }); res.json(serviceToApi(result)); });
app.delete('/api/services/:id', async (req, res) => { const serviceId = id(req.params.id); const db = getDatabase(); const result = await db.collection('services').deleteOne({ legacyId: serviceId }); if (!result.deletedCount) throw Object.assign(new Error('Service not found.'), { status: 404 }); await Promise.all([db.collection('healthChecks').deleteMany({ serviceId }), db.collection('deployments').deleteMany({ serviceId }), db.collection('incidents').updateMany({ serviceId }, { $set: { serviceId: null } })]); res.status(204).end(); });

app.get('/api/health-checks', async (_req, res) => { const records = await getDatabase().collection('healthChecks').aggregate([{ $match: { legacyId: { $exists: true } } }, { $lookup: { from: 'services', localField: 'serviceId', foreignField: 'legacyId', as: 'service' } }, { $sort: { checked_at: -1 } }]).toArray(); res.json(records.map((record) => healthToApi(record, record.service[0]?.name))); });
app.post('/api/health-checks', async (req, res) => { const service = await serviceExists(req.body.serviceId); let status = 'unhealthy', responseTime = null, message = 'Connection failed'; const started = Date.now(); try { const response = await fetch(service.url, { signal: AbortSignal.timeout(5000) }); responseTime = Date.now() - started; status = response.ok ? 'healthy' : 'unhealthy'; message = `HTTP ${response.status}`; } catch (error) { responseTime = Date.now() - started; message = error.name === 'TimeoutError' ? 'Request timed out' : 'Connection failed'; } const check = { legacyId: await nextLegacyId('healthChecks'), serviceId: service.legacyId, status, responseTime, message, checked_at: now() }; await getDatabase().collection('healthChecks').insertOne(check); await getDatabase().collection('services').updateOne({ legacyId: service.legacyId }, { $set: { status, updated_at: now() } }); res.status(201).json(healthToApi(check, service.name)); });

app.get('/api/deployments', async (_req, res) => { const records = await getDatabase().collection('deployments').aggregate([{ $match: { legacyId: { $exists: true } } }, { $lookup: { from: 'services', localField: 'serviceId', foreignField: 'legacyId', as: 'service' } }, { $sort: { deployed_at: -1 } }]).toArray(); res.json(records.map((record) => deploymentToApi(record, record.service[0]?.name))); });
app.post('/api/deployments', async (req, res) => { const { serviceId, version, environment, status = 'successful', notes = '' } = req.body; const service = await serviceExists(serviceId); required(version, 'Version'); if (!['development', 'staging', 'production'].includes(environment) || !['pending', 'successful', 'failed'].includes(status)) throw Object.assign(new Error('Invalid deployment values.'), { status: 400 }); const deployment = { legacyId: await nextLegacyId('deployments'), serviceId: service.legacyId, version: version.trim(), environment, status, notes: notes.trim(), deployed_at: now() }; await getDatabase().collection('deployments').insertOne(deployment); res.status(201).json(deploymentToApi(deployment, service.name)); });

app.get('/api/incidents', async (_req, res) => { const records = await getDatabase().collection('incidents').aggregate([{ $match: { legacyId: { $exists: true } } }, { $lookup: { from: 'services', localField: 'serviceId', foreignField: 'legacyId', as: 'service' } }, { $sort: { created_at: -1 } }]).toArray(); res.json(records.map((record) => incidentToApi(record, record.service[0]?.name))); });
app.post('/api/incidents', async (req, res) => { const { serviceId = null, title, description, severity } = req.body; const service = serviceId ? await serviceExists(serviceId) : null; required(title, 'Title'); required(description, 'Description'); if (!['low', 'medium', 'high', 'critical'].includes(severity)) throw Object.assign(new Error('Invalid severity.'), { status: 400 }); const incident = { legacyId: await nextLegacyId('incidents'), serviceId: service?.legacyId ?? null, title: title.trim(), description: description.trim(), severity, status: 'open', created_at: now(), resolved_at: null }; await getDatabase().collection('incidents').insertOne(incident); res.status(201).json(incidentToApi(incident, service?.name)); });
app.patch('/api/incidents/:id/resolve', async (req, res) => { const result = await getDatabase().collection('incidents').findOneAndUpdate({ legacyId: id(req.params.id) }, { $set: { status: 'resolved', resolved_at: now() } }, { returnDocument: 'after', includeResultMetadata: false }); if (!result) throw Object.assign(new Error('Incident not found.'), { status: 404 }); res.json(incidentToApi(result)); });

app.use((req, _res, next) => next(Object.assign(new Error(`Route ${req.method} ${req.path} not found.`), { status: 404 })));
app.use((error, _req, res, _next) => { console.error(error); const databaseError = error.name?.includes('Mongo') || error.status === 503; res.status(error.status || (databaseError ? 503 : 500)).json({ error: error.status ? error.message : databaseError ? 'Database unavailable.' : 'Internal server error.' }); });
export async function startServer() {
  await connectDatabase();
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(port, () => resolve(listener));
    listener.once('error', reject);
  });
  console.log(`CloudOps API running at http://localhost:${port}`);
  const shutdown = async () => { server.close(async () => { await closeDatabase(); process.exit(0); }); };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
  return server;
}
const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) startServer().catch((error) => { console.error(`Unable to start CloudOps API: ${error.message}`); closeDatabase().finally(() => process.exit(1)); });
export default app;

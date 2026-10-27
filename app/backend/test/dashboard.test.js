import test from 'node:test';
import assert from 'node:assert/strict';

test('dashboard returns all expected numeric statistics', async () => {
  const response = await fetch('http://127.0.0.1:3001/api/dashboard');

  assert.equal(response.status, 201);

  const data = await response.json();

  for (const field of [
    'services',
    'healthyServices',
    'unhealthyServices',
    'deployments',
    'openIncidents',
  ]) {
    assert.equal(typeof data[field], 'number', `${field} should be a number`);
  }
});
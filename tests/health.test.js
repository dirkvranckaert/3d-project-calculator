'use strict';

const request = require('supertest');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const testDbPath = path.join(os.tmpdir(), `calculator-health-${process.pid}.db`);
process.env.NODE_ENV = 'test';
process.env.ADMIN_USER = 'testadmin';
process.env.ADMIN_PASS = 'testpass';
process.env.DB_PATH = testDbPath;

const { app: expressApp, getDb } = require('../server');
const server = http.createServer(expressApp).listen(0, '127.0.0.1');

afterEach(() => jest.restoreAllMocks());
afterAll(() => new Promise((resolve) => server.close(() => {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(testDbPath + suffix, { force: true });
  resolve();
})));

describe('GET /health (DB probe)', () => {
  test('200 {ok:true} when the DB works, with no cookie', async () => {
    const res = await request(server).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  test('503 {ok:false,error:"db"} when DB access throws, without leaking details', async () => {
    jest.spyOn(getDb(), 'prepare').mockImplementation(() => {
      throw new Error('boom /secret/path/calculator.db NODE_MODULE_VERSION 115');
    });
    const res = await request(server).get('/health');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ok: false, error: 'db' });
    expect(res.text).not.toMatch(/boom|secret|NODE_MODULE_VERSION|\.db/);
  });

  test('does not redirect to /login and other API routes still require auth', async () => {
    const health = await request(server).get('/health');
    expect(health.status).not.toBe(302);
    const other = await request(server).get('/api/projects');
    expect(other.status).toBe(401);
  });
});

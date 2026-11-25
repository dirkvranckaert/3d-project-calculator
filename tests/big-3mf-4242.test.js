'use strict';

/**
 * #4242: importing a ~300 MB sliced .gcode.3mf failed. The server buffered the
 * whole upload in RAM (PM2 max_memory_restart 256M killed it) and the frontend
 * hid the real error behind "Failed to parse server response".
 */

const request = require('supertest');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const { execFileSync } = require('child_process');

const testDbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'big3mf-')), 'test.db');
process.env.NODE_ENV = 'test';
process.env.ADMIN_USER = 'testadmin';
process.env.ADMIN_PASS = 'testpass';
process.env.DB_PATH = testDbPath;

const { app: expressApp } = require('../server');
const app = http.createServer(expressApp).listen(0);
afterAll(() => new Promise((resolve) => app.close(resolve)));

const SLICE_INFO = '<?xml version="1.0"?><config><plate>' +
  '<metadata key="index" value="1"/><metadata key="prediction" value="3600"/>' +
  '<metadata key="weight" value="12.5"/>' +
  '<filament id="1" type="PLA" color="#FF0000" used_m="4" used_g="12.5"/></plate></config>';

let dir, bigPath, cookie;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'big3mf-zip-'));
  const meta = path.join(dir, 'Metadata');
  fs.mkdirSync(meta);
  fs.writeFileSync(path.join(meta, 'slice_info.config'), SLICE_INFO);
  // 160 MB of non-compressible-sized gcode, stored (-0) so the zip is ~160 MB too
  fs.writeFileSync(path.join(meta, 'plate_1.gcode'), Buffer.alloc(160 * 1024 * 1024, 'G1 X1 Y1\n'));
  bigPath = path.join(dir, 'big.gcode.3mf');
  execFileSync('zip', ['-0', '-r', '-q', bigPath, 'Metadata'], { cwd: dir });

  const login = await request(app).post('/login').send({ username: 'testadmin', password: 'testpass' });
  if (!login.headers['set-cookie']) throw new Error('login failed ' + login.status + ' ' + JSON.stringify(login.body));
  cookie = login.headers['set-cookie'][0].split(';')[0];
}, 120000);

afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('big gcode.3mf import (#4242)', () => {
  test('/api/parse-3mf parses a 160 MB gcode.3mf and leaves no temp file', async () => {
    const tmpBefore = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('parse3mf_')).length;
    const res = await request(app).post('/api/parse-3mf')
      .set('Cookie', cookie).set('Content-Type', 'application/octet-stream')
      .send(fs.readFileSync(bigPath));
    expect(res.status).toBe(200);
    expect(res.type).toBe('application/json');
    expect(res.body.sliced).toBe(true);
    expect(res.body.plates[0].weightGrams).toBe(12.5);
    expect(fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('parse3mf_')).length).toBe(tmpBefore);
  }, 120000);

  test('/api/parse-3mf empty body -> 400 JSON', async () => {
    const res = await request(app).post('/api/parse-3mf')
      .set('Cookie', cookie).set('Content-Type', 'application/octet-stream').send(Buffer.alloc(0));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Empty body/);
  });

  test('/api/projects/:id/files stores a big 3MF by streaming and reports size', async () => {
    const p = await request(app).post('/api/projects').set('Cookie', cookie).send({ name: 'Big' });
    const pid = p.body.id;
    const res = await request(app).post(`/api/projects/${pid}/files`)
      .set('Cookie', cookie).set('Content-Type', 'application/octet-stream')
      .set('X-Filename', 'big.gcode.3mf').send(fs.readFileSync(bigPath));
    expect(res.status).toBe(201);
    expect(res.body.size_bytes).toBe(fs.statSync(bigPath).size);
    expect(res.body.is_sliced).toBe(1);
  }, 120000);
});

describe('streamToFile over-cap (round 1 finding 1)', () => {
  const { streamToFile } = require('../lib/stream-upload');

  test('client gets a JSON 413, not a connection reset, and no partial file remains', async () => {
    const dest = path.join(dir, 'capped.bin');
    const srv = http.createServer(async (req, res) => {
      try { await streamToFile(req, dest, 1024 * 1024); res.end('{}'); }
      catch (e) { res.statusCode = e.status || 500; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: e.message })); }
    }).listen(0);
    try {
      // Raw client: the server may close after replying while we still write
      // (EPIPE on the write side is fine as long as the JSON reply arrived).
      const res = await new Promise((resolve, reject) => {
        const r = http.request({ port: srv.address().port, method: 'POST', path: '/', headers: { 'Content-Type': 'application/octet-stream' } }, (resp) => {
          let b = '';
          resp.on('data', (c) => { b += c; });
          resp.on('end', () => resolve({ status: resp.statusCode, body: JSON.parse(b) }));
        });
        r.on('error', (e) => { if (e.code !== 'EPIPE') reject(e); });
        r.end(Buffer.alloc(8 * 1024 * 1024));
      });
      expect(res.status).toBe(413);
      expect(res.body.error).toMatch(/exceeds/);
      expect(fs.existsSync(dest)).toBe(false);
    } finally { srv.close(); }
  });
});

describe('extractThumbnails memory budget (round 1 finding 2)', () => {
  const { extractThumbnails } = require('../parse3mf');
  test('skips oversized plate PNGs, keeps small ones', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbs-'));
    const meta = path.join(d, 'Metadata');
    fs.mkdirSync(meta);
    fs.writeFileSync(path.join(meta, 'plate_1.png'), Buffer.alloc(9 * 1024 * 1024, 1)); // > 8 MiB cap
    fs.writeFileSync(path.join(meta, 'plate_2.png'), Buffer.alloc(2000, 2));
    const z = path.join(d, 't.3mf');
    execFileSync('zip', ['-0', '-r', '-q', z, 'Metadata'], { cwd: d });
    const thumbs = extractThumbnails(z);
    expect(thumbs.map(t => t.plateIndex)).toEqual([2]);
    fs.rmSync(d, { recursive: true, force: true });
  });
});

describe('describeNonJsonResponse (frontend)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const m = src.match(/function describeNonJsonResponse\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(m[0], sandbox);

  test('surfaces status and stripped HTML body of a proxy 413', () => {
    const msg = sandbox.describeNonJsonResponse(413, 'Request Entity Too Large',
      '<html><body><h1>413 Request Entity Too Large</h1><hr>nginx</body></html>');
    expect(msg).toContain('HTTP 413 Request Entity Too Large');
    expect(msg).toContain('nginx');
    expect(msg).not.toContain('<');
  });

  test('empty body still names the status', () => {
    expect(sandbox.describeNonJsonResponse(502, '', '')).toBe('Server returned HTTP 502 (empty response)');
  });
});

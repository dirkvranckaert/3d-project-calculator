'use strict';

const fs = require('fs');

/**
 * Stream a request body straight to disk (constant memory, unlike
 * express.raw which buffers the whole upload in RAM). A sliced .gcode.3mf is
 * easily 300 MB; buffering that blew past PM2's max_memory_restart.
 *
 * Deliberately NOT stream.pipeline(): on error pipeline destroys the
 * IncomingMessage and its socket, so the client gets a connection reset
 * instead of the JSON error the route sends. On failure we unpipe, keep the
 * request draining (resume) and let the caller respond.
 *
 * Resolves with the byte count. Rejects with err.status = 413 when the body
 * exceeds maxBytes; the partial file is removed on any failure.
 */
function streamToFile(req, destPath, maxBytes) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(destPath);
    let bytes = 0;
    let done = false;

    const fail = (err) => {
      if (done) return;
      done = true;
      req.unpipe(out);
      req.removeListener('data', onData);
      req.resume(); // drain, never destroy the socket
      // Remove the file only after the write stream has fully closed: destroying
      // during a pending open() would otherwise create the file after cleanup.
      // Removal errors never block the rejection.
      const finish = () => {
        try { fs.rmSync(destPath, { force: true }); } catch { /* best effort */ }
        reject(err);
      };
      if (out.closed) finish();
      else { out.once('close', finish); out.destroy(); }
    };
    const onData = (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        const err = new Error(`Upload exceeds the ${Math.round(maxBytes / 1048576)} MB limit`);
        err.status = 413;
        fail(err);
      }
    };

    out.on('error', fail);
    out.on('finish', () => {
      if (done) return;
      done = true;
      resolve(bytes);
    });
    req.on('data', onData);
    req.on('aborted', () => fail(new Error('Upload aborted by client')));
    req.on('error', fail);
    req.pipe(out);
  });
}

module.exports = { streamToFile };

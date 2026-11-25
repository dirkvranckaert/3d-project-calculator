'use strict';

const fs = require('fs');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');

/**
 * Stream a request body straight to disk (constant memory, unlike
 * express.raw which buffers the whole upload in RAM). A sliced .gcode.3mf is
 * easily 300 MB; buffering that blew past PM2's max_memory_restart.
 *
 * Resolves with the byte count. Rejects with err.status = 413 when the body
 * exceeds maxBytes (the partial file is removed either way on failure).
 */
async function streamToFile(req, destPath, maxBytes) {
  let bytes = 0;
  const limiter = new Transform({
    transform(chunk, _enc, cb) {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        const err = new Error(`Upload exceeds the ${Math.round(maxBytes / 1048576)} MB limit`);
        err.status = 413;
        return cb(err);
      }
      cb(null, chunk);
    },
  });
  try {
    await pipeline(req, limiter, fs.createWriteStream(destPath));
  } catch (err) {
    fs.rmSync(destPath, { force: true });
    throw err;
  }
  return bytes;
}

module.exports = { streamToFile };

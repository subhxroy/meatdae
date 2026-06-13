const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8888;
const ROOT = __dirname;

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.wav': 'audio/wav',
  '.wasm': 'application/wasm',
  '.map': 'application/json'
};

http.createServer((req, res) => {
  // Parse URL - strip query string for file path, but keep it for logging
  const urlParts = req.url.split('?');
  let urlPath = decodeURIComponent(urlParts[0]);

  // Default: serve index.html for directory requests
  let filePath = path.join(ROOT, urlPath);

  // If path is a directory, serve its index.html
  try {
    if (fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
  } catch (e) {
    // File doesn't exist yet, will be handled below
  }

  const serveFile = (targetPath) => {
    const ext = path.extname(targetPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(targetPath, (err, content) => {
      if (err) {
        if (err.code === 'ENOENT') {
          // Fallback logic: check subprojects for the file
          const subprojects = ['customer', 'staff'];
          for (const sub of subprojects) {
            const fallbackPath = path.join(ROOT, sub, urlPath);
            try {
              if (fs.existsSync(fallbackPath) && !fs.statSync(fallbackPath).isDirectory()) {
                return serveFile(fallbackPath);
              }
            } catch (e) {}
          }

          console.log(`[404] ${req.url} -> ${targetPath}`);
          res.writeHead(404, { 'Content-Type': 'text/html' });
          res.end('<h1>404 - Not Found</h1>', 'utf-8');
        } else {
          console.error(`[500] ${req.url} -> ${err.message}`);
          res.writeHead(500);
          res.end('Server Error');
        }
      } else {
        // No caching during development
        res.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        });
        res.end(content);
      }
    });
  };

  serveFile(filePath);
}).listen(PORT, () => {
  console.log('');
  console.log('  ┌──────────────────────────────────────┐');
  console.log(`  │  MeatDae Dev Server running on:       │`);
  console.log(`  │  http://localhost:${PORT}               │`);
  console.log('  │                                      │');
  console.log(`  │  Customer: /customer/index.html       │`);
  console.log(`  │  Staff:    /staff/index.html          │`);
  console.log('  └──────────────────────────────────────┘');
  console.log('');
});

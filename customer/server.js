const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.woff': 'application/font-woff',
  '.ttf': 'application/font-ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.otf': 'application/font-otf',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

http.createServer((request, response) => {
  let url = decodeURIComponent(request.url.split('?')[0]);
  let filePath = path.join(__dirname, url === '/' ? 'index.html' : url.startsWith('/') ? url.substring(1) : url);
  console.log(`[SERVER] Handling request for: ${url} -> ${filePath}`);
  
  const extname = String(path.extname(filePath)).toLowerCase();
  const contentType = MIME_TYPES[extname] || 'application/octet-stream';

  fs.readFile(filePath, (error, content) => {
    if (error) {
      console.error(`[SERVER] Error reading file ${filePath}: ${error.code}`);
      if(error.code == 'ENOENT') {
        response.writeHead(404, { 'Content-Type': 'text/plain' });
        response.end('404 Not Found', 'utf-8');
      } else {
        response.writeHead(500);
        response.end('Error: '+error.code, 'utf-8');
      }
    } else {
      response.writeHead(200, { 'Content-Type': contentType });
      response.end(content, 'utf-8');
    }
  });
}).listen(PORT, () => {
  console.log(`Customer Application running at http://localhost:${PORT}/`);
});

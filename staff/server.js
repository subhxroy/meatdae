const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8081;

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
  '.webp': 'image/webp'
};

http.createServer((request, response) => {
  let url = decodeURIComponent(request.url.split('?')[0]);
  let filePath;

  if (url.startsWith('/customer/')) {
    // If request for customer folder, look in parent directory
    filePath = path.resolve(__dirname, '..', url.startsWith('/') ? url.substring(1) : url);
  } else {
    // Directly serve from this folder
    filePath = path.join(__dirname, url === '/' ? 'index.html' : url.startsWith('/') ? url.substring(1) : url);
  }
  
  const extname = String(path.extname(filePath)).toLowerCase();
  const contentType = MIME_TYPES[extname] || 'application/octet-stream';

  fs.readFile(filePath, (error, content) => {
    if (error) {
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
  console.log(`Staff Portal running at http://localhost:${PORT}/`);
});

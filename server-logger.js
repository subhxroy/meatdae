const http = require('http');
const fs = require('fs');

const server = http.createServer((req, res) => {
    // Add CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            console.log("Received DOM HTML, length:", body.length);
            fs.writeFileSync('debug_dom.html', body);
            res.writeHead(200);
            res.end('OK');
            
            // Exit after receiving payload
            setTimeout(() => process.exit(0), 1000);
        });
    } else {
        res.writeHead(200);
        res.end('Listening...');
    }
});

server.listen(9999, () => {
    console.log('Logger listening on http://localhost:9999');
});

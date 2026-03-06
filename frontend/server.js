const http = require('http')
const fs = require('fs')
const path = require('path')

const HTML_FILE = path.join(__dirname, 'index.html')
const PORT = 3000

http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    fs.readFile(HTML_FILE, (err, data) => {
      if (err) {
        res.writeHead(500)
        res.end('Internal Server Error')
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(data)
    })
  } else {
    res.writeHead(404)
    res.end('Not Found')
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Frontend listening on http://0.0.0.0:${PORT}`)
})

const express = require('express')
const path = require('path')
const http = require('http')
const cors = require('cors')

// SERVER CONFIG
const PORT = process.env.PORT || 5004
const app = express();
const server = http.createServer(app);

server.listen(PORT, () => console.log(`Listening on ${PORT}\n`));

// Graceful error handling for port conflicts
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Retrying in 5 seconds...`);
    setTimeout(() => {
      server.close();
      server.listen(PORT);
    }, 5000);
  } else {
    console.error('Server error:', err);
  }
});

app.use(express.static(path.join(__dirname, 'public')))
app.use(cors({ credentials: true, origin: '*' }))
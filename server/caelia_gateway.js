import { createServer } from 'node:http';
import { createApp, loadConfig } from './src/app.js';

const config = loadConfig();
const app = createApp({ config });
const server = createServer(app);

server.listen(config.port, '0.0.0.0', () => {
  console.log(`Caelia passkey server listening on port ${config.port}`);
});

function shutdown() {
  server.close(() => {
    app.locals.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

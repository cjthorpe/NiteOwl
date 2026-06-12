import { buildApp } from './app.js';

const PORT = Number(process.env['PORT'] ?? process.env['API_PORT'] ?? 3001);
const HOST = process.env['HOST'] ?? process.env['API_HOST'] ?? '0.0.0.0';

const app = buildApp();

app.listen({ port: PORT, host: HOST }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
});

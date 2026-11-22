import { createApp } from './app.js';
import { UrlStore } from './store.js';

const rawPort = process.env.PORT ?? '3000';
if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}
const store = new UrlStore(process.env.SHORT_URL_BASE_URL);
const server = createApp(store);
server.listen(Number(rawPort), '0.0.0.0', () => {
  console.log(`Listening on port ${rawPort}; short URL origin: ${store.base}`);
});

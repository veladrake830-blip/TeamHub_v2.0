import { createApp } from './app.ts';
import { config } from './config.ts';

if (!process.env.PUBLIC_URL) console.warn(`PUBLIC_URL is not set, so reset links will point at ${config.publicUrl}.`);

createApp().listen(config.port, config.host ?? '0.0.0.0', () => {
  console.log(`TeamHub server listening on port ${config.port}`);
});

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.ts';
import { notFound } from './lib/errors.ts';
import { errorHandler } from './middleware/errors.ts';
import { activityRouter } from './routes/activity.ts';
import { adminRouter } from './routes/admin.ts';
import { authRouter } from './routes/auth.ts';
import { answersRouter, postsRouter } from './routes/posts.ts';
import { settingsRouter } from './routes/settings.ts';
import { invitationsRouter, teamsRouter } from './routes/teams.ts';
import { usersRouter } from './routes/users.ts';
import { workLogsRouter } from './routes/workLogs.ts';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxyHops);
  app.use(
    helmet({
      // no-referrer keeps reset tokens in URLs from leaking to other sites.
      referrerPolicy: { policy: 'no-referrer' },
      // On plain HTTP these would make browsers demand HTTPS and show a blank page.
      contentSecurityPolicy: { directives: { upgradeInsecureRequests: config.cookieSecure ? [] : null } },
      strictTransportSecurity: config.cookieSecure,
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/teams', teamsRouter);
  app.use('/api/invitations', invitationsRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/work-logs', workLogsRouter);
  app.use('/api/activity', activityRouter);
  app.use('/api/posts', postsRouter);
  app.use('/api/answers', answersRouter);
  app.use('/api', () => {
    throw notFound();
  });

  app.use('/uploads', express.static(resolve(config.uploadDir), { index: false, maxAge: '1d' }));

  // In production the server also hosts the built client.
  const clientDist = resolve(import.meta.dirname, '../../client/dist');
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get(/.*/, (_req, res) => res.sendFile(join(clientDist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}

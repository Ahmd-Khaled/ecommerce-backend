import { bootstrap } from './app.controller';
import mongoose from 'mongoose';
import { closeEmailQueue } from './Utils/email/email.queue';
import { logger } from './Utils/logging/logger';
import { closeSystemLogs } from './Utils/logging/system-log.transport';
import { closeSystemLogRateStores } from './Utils/logging/system-log.rate-store';

const startServer = async () => {
  try {
    const server = await bootstrap();
    let stopping = false;
    const shutdown = async () => {
      if (stopping) return;
      stopping = true;
      const deadline = setTimeout(() => process.exit(1), 30000);
      deadline.unref();
      try {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
        await closeEmailQueue();
        await closeSystemLogs();
        closeSystemLogRateStores();
        await mongoose.disconnect();
        clearTimeout(deadline);
      } catch (error) {
        logger.write({ kind: 'operational', action: 'application.stop_failed', level: 'error', outcome: 'failure' });
        process.exit(1);
      }
    };
    process.once('SIGTERM', () => void shutdown());
    process.once('SIGINT', () => void shutdown());
  } catch (error) {
    logger.write({ kind: 'operational', action: 'application.start_failed', level: 'error', outcome: 'failure' });
    // Fatal startup diagnostics must remain visible even when stdout logging is muted.
    console.error('Application failed to start.');
    if ((process.env.NODE_ENV ?? process.env.MODE) !== 'production') {
      console.error(error);
    }
    process.exit(1);
  }
};

startServer();

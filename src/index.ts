import { bootstrap } from './app.controller';
import mongoose from 'mongoose';
import { closeEmailQueue } from './Utils/email/email.queue';
import { logger } from './Utils/logging/logger';

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
    process.exit(1);
  }
};

startServer();

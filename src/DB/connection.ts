import mongoose from 'mongoose';
import { setTimeout as delay } from 'node:timers/promises';

const connectDB = async (): Promise<void> => {
  const mongoURI = process.env.MONGO_URI;

  if (!mongoURI) {
    throw new Error('MONGO_URI is not defined in environment variables');
  }

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const conn = await mongoose.connect(mongoURI, {
        // Allow time for Atlas discovery and replica-set elections.
        serverSelectionTimeoutMS: 30000,
      });
      console.log(`MongoDB Connected: ${conn.connection.host}`);
      return;
    } catch (error) {
      const retryable =
        error instanceof Error &&
        [
          'MongooseServerSelectionError',
          'MongoServerSelectionError',
          'MongoNetworkError',
          'MongoNetworkTimeoutError',
        ].includes(error.name);

      if (!retryable) throw error;
      if (attempt === maxAttempts) {
        console.error(
          'MongoDB remains unreachable after 3 attempts. Check Atlas cluster status, ' +
            'your current public IP in Network Access, and outbound TCP port 27017 (firewall/VPN).',
        );
        throw error;
      }

      const retryDelayMS = attempt * 2000;
      console.warn(
        `MongoDB connection attempt ${attempt}/${maxAttempts} failed (${error.name}). ` +
          `Retrying in ${retryDelayMS / 1000}s...`,
      );
      await delay(retryDelayMS);
    }
  }
};

export default connectDB;

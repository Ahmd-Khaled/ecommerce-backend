import { bootstrap } from "./app.controller";
import mongoose from "mongoose";
import { closeEmailQueue } from "./Utils/email/email.queue";

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
          server.close(error => error ? reject(error) : resolve());
        });
        await closeEmailQueue();
        await mongoose.disconnect();
        clearTimeout(deadline);
      } catch (error) {
        console.error("Application shutdown failed:", error);
        process.exit(1);
      }
    };
    process.once("SIGTERM", () => void shutdown());
    process.once("SIGINT", () => void shutdown());
  } catch (error) {
    console.error("Application startup failed:", error);
    process.exit(1);
  }
};

startServer();

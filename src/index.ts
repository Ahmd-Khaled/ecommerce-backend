import { bootstrap } from "./app.controller";

const startServer = async () => {
  try {
    await bootstrap();
  } catch (error) {
    console.error("Application startup failed:", error);
    process.exit(1);
  }
};

startServer();
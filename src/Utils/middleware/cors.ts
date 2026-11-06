import type { CorsOptions } from "cors";
import { ForbiddenException } from "../response/error.response";

export const corsOptions = (): CorsOptions => {
  const origins = (process.env.CORS_ORIGINS ?? "").split(",").map(origin => origin.trim()).filter(Boolean);
  return {
    credentials: true,
    origin(origin, callback) {
      if (!origin || origins.includes(origin)) callback(null, true);
      else callback(new ForbiddenException("Origin is not allowed"));
    },
  };
};

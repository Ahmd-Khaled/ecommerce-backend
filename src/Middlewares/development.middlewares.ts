import type { RequestHandler } from "express";
import { NotFoundException } from "../Utils/response/error.response";

export const developmentOnly: RequestHandler = (_req, _res, next): void => {
  // Evaluate after dotenv has loaded, when a request arrives.
  if (process.env.MODE !== "DEV" || process.env.NODE_ENV === "production") {
    throw new NotFoundException("Not Found");
  }

  next();
};

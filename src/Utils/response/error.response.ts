import { NextFunction, Request, Response } from "express";

export interface IError extends Error {
  statusCode: number;
}

export class ApplicationException extends Error {

  constructor(
    message: string,
    public statusCode: number = 400,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = this.constructor.name;
  }
}

export class BadRequestException extends ApplicationException {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 400, options);
  }
}
export class NotFoundException extends ApplicationException {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 404, options);
  }
}
export class ConflictException extends ApplicationException {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 409, options);
  }
}

export class UnauthorizedException extends ApplicationException {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 401, options);
  }
}
export class ForbiddenException extends ApplicationException {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 403, options);
  }
}


export const globalErrorHandler = (err: IError, req: Request, res: Response, next: NextFunction) => {
  return res.status(err.statusCode || 500).json({
    message: err.message || "Something went wrong",
    stack: process.env.MODE === "DEV" ? err.stack : undefined,
    cause: process.env.MODE === "DEV" ? err.cause : undefined
  });
} 
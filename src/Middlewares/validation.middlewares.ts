import type { RequestHandler } from "express";
import { BadRequestException } from "../Utils/response/error.response";
import type { ZodType } from "zod";


type KeyReqType = "body" | "params" | "query" | "headers" | "cookies";
type SchemaType = Partial<Record<KeyReqType, ZodType>>;
type ValidationErrorType = Array<{
  key: KeyReqType;
  issues: Array<{ message: string; path: (string | number | symbol)[] }>
}>;

export const validations = (schema: SchemaType): RequestHandler => {
  return (req, _res, next): void => {
    const validationErrors: ValidationErrorType = [];
    const parsedSections: Partial<Record<KeyReqType, unknown>> = {};

    for (const key of Object.keys(schema) as KeyReqType[]) {
      const sectionSchema = schema[key];
      if (!sectionSchema) continue;

      const validationResults = sectionSchema.safeParse(req[key]);

      if (!validationResults.success) {
        validationErrors.push({
          key,
          issues: validationResults.error.issues.map((issue) => ({
            message: issue.message,
            path: issue.path,
          })),
        });
      } else {
        parsedSections[key] = validationResults.data;
      }
    }

    if (validationErrors.length > 0) {
      throw new BadRequestException("Validation Error", { cause: validationErrors });
    }

    for (const key of Object.keys(parsedSections) as KeyReqType[]) {
      // Express 5 exposes query through a getter; define an own property to
      // preserve parsed output for downstream handlers, including defaults.
      Object.defineProperty(req, key, {
        value: parsedSections[key],
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }

    next();
  };
};

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validations = void 0;
const error_response_1 = require("../Utils/response/error.response");
const validations = (schema) => {
    return (req, _res, next) => {
        const validationErrors = [];
        const parsedSections = {};
        for (const key of Object.keys(schema)) {
            const sectionSchema = schema[key];
            if (!sectionSchema)
                continue;
            const validationResults = sectionSchema.safeParse(req[key]);
            if (!validationResults.success) {
                validationErrors.push({
                    key,
                    issues: validationResults.error.issues.map((issue) => ({
                        message: issue.message,
                        path: issue.path,
                    })),
                });
            }
            else {
                parsedSections[key] = validationResults.data;
            }
        }
        if (validationErrors.length > 0) {
            throw new error_response_1.BadRequestException("Validation Error", { cause: validationErrors });
        }
        for (const key of Object.keys(parsedSections)) {
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
exports.validations = validations;

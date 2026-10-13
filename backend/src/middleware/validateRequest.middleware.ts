
import type { RequestHandler } from "express";

type Validator = (input: unknown) => {
  valid: boolean;
  errors: string[];
  data?: unknown;
};

export function validateRequest(
  validator: Validator,
): RequestHandler {
  return (req, res, next) => {
    const result = validator(req.body);

    if (!result.valid) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          details: result.errors,
        },
      });
      return;
    }

    res.locals.validatedBody = result.data;
    next();
  };
}

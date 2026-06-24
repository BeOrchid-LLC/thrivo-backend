import { describe, expect, it } from "vitest";
import {
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  InternalError,
} from "../../src/lib/errors";

describe("AppError hierarchy", () => {
  it("maps each subclass to its stable code + HTTP status", () => {
    const cases: Array<[AppError, string, number]> = [
      [new ValidationError("bad", { field: "x" }), "VALIDATION_ERROR", 422],
      [new UnauthorizedError(), "UNAUTHENTICATED", 401],
      [new ForbiddenError(), "FORBIDDEN", 403],
      [new NotFoundError("missing"), "NOT_FOUND", 404],
      [new ConflictError("dupe"), "CONFLICT", 409],
      [new InternalError(), "INTERNAL_ERROR", 500],
    ];
    for (const [err, code, status] of cases) {
      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe(code);
      expect(err.status).toBe(status);
    }
  });

  it("carries optional details and a class name", () => {
    const err = new ValidationError("bad", { field: "email" });
    expect(err.details).toEqual({ field: "email" });
    expect(err.name).toBe("ValidationError");
  });
});

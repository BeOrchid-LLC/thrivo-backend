// Minimal AppError hierarchy + stable error-code enum. A1-6 extends this with
// the full set of codes and the HTTP error boundary; repositories/services
// throw these and the boundary maps them to { error: { code, message, details? } }.

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "PREMIUM_REQUIRED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "PAYLOAD_TOO_LARGE"
  | "UPSTREAM_ERROR"
  | "APP_UPDATE_REQUIRED"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, status: number, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message = "Validation failed", details?: unknown) {
    super("VALIDATION_ERROR", message, 422, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super("UNAUTHENTICATED", message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super("FORBIDDEN", message, 403);
  }
}

/** 403 with a distinct code so clients can show an upgrade prompt (vs a plain forbid). */
export class PremiumRequiredError extends AppError {
  constructor(message = "Premium subscription required") {
    super("PREMIUM_REQUIRED", message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found", details?: unknown) {
    super("NOT_FOUND", message, 404, details);
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict", details?: unknown) {
    super("CONFLICT", message, 409, details);
  }
}

export class RateLimitedError extends AppError {
  constructor(message = "Too many requests", details?: unknown) {
    super("RATE_LIMITED", message, 429, details);
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message = "Request body too large", details?: unknown) {
    super("PAYLOAD_TOO_LARGE", message, 413, details);
  }
}

export class InternalError extends AppError {
  constructor(message = "Internal server error", details?: unknown) {
    super("INTERNAL_ERROR", message, 500, details);
  }
}

/** 502 — an upstream dependency (e.g. an OAuth provider) failed or misbehaved. */
export class UpstreamError extends AppError {
  constructor(message = "Upstream service error", details?: unknown) {
    super("UPSTREAM_ERROR", message, 502, details);
  }
}

/** Stable 503 shape used by the mobile post-purchase sync retry loop. */
export class BillingSyncUnavailableError extends AppError {
  constructor(message = "Subscription activation is temporarily unavailable", details?: unknown) {
    super("UPSTREAM_ERROR", message, 503, {
      reason: "BILLING_SYNC_UNAVAILABLE",
      ...(details && typeof details === "object" ? details : {}),
    });
  }
}

export class AppUpdateRequiredError extends AppError {
  constructor(message = "Please update Thrivo to continue") {
    super("APP_UPDATE_REQUIRED", message, 426);
  }
}

export class ReverificationRequiredError extends AppError {
  constructor(message = "Please verify your identity again before continuing") {
    super("FORBIDDEN", message, 403, { reason: "REVERIFICATION_REQUIRED" });
  }
}

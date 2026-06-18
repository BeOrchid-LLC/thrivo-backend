# @beorchid-llc/thrivo-contracts

Shared Zod schemas, DTO types, error codes, and route metadata for Thrivo clients.

The backend is the source of truth. Backend route validation and controller responses should use these
schemas directly, then mobile/admin/public consume the published package instead of maintaining local
mirrors.

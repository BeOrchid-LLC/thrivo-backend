import { z } from "zod";
import type { RouteContract } from "./common";

export const accountDeletionRequestPayloadSchema = z.object({
  email: z
    .string()
    .email()
    .max(254)
    .transform((email) => email.trim().toLowerCase()),
});
export type AccountDeletionRequestPayload = z.infer<typeof accountDeletionRequestPayloadSchema>;

export const accountDeletionRequestResponseSchema = z.null();
export const accountDeletionConfirmationPayloadSchema = z.object({
  token: z.string().min(32).max(256),
});
export type AccountDeletionConfirmationPayload = z.infer<
  typeof accountDeletionConfirmationPayloadSchema
>;

export const accountDeletionConfirmationResponseSchema = z.object({
  status: z.literal("queued"),
});
export type AccountDeletionConfirmationResponse = z.infer<
  typeof accountDeletionConfirmationResponseSchema
>;

export const accountDeletionRoutes = {
  request: {
    method: "POST",
    path: "/api/v1/account-deletion-requests",
    auth: "public",
  },
  confirm: {
    method: "POST",
    path: "/api/v1/account-deletion-requests/confirm",
    auth: "public",
  },
} satisfies Record<string, RouteContract>;

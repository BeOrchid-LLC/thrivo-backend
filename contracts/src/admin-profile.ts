import { z } from "zod";
import { adminPaginated } from "./admin";
import { adminAccountSchema, adminPermissionSchema } from "./admin-management";
import { adminAuditLogEntrySchema } from "./admin-logs";

/** The source of the permissions returned in `effectivePermissions`. */
export const adminPermissionSourceSchema = z.enum(["role", "custom"]);
export type AdminPermissionSource = z.infer<typeof adminPermissionSourceSchema>;

/** Provider used by the Thrivo Admin application. */
export const adminAuthProviderSchema = z.literal("clerk");
export type AdminAuthProvider = z.infer<typeof adminAuthProviderSchema>;

/**
 * The authenticated admin's full, read-only profile. Internal Clerk IDs and
 * password material are deliberately excluded from this client-facing DTO.
 */
export const adminSelfProfileSchema = adminAccountSchema.extend({
  effectivePermissions: z.array(adminPermissionSchema),
  permissionSource: adminPermissionSourceSchema,
  authProvider: adminAuthProviderSchema,
});
export type AdminSelfProfile = z.infer<typeof adminSelfProfileSchema>;

export const adminSelfProfileResponseSchema = z.object({ admin: adminSelfProfileSchema });
export type AdminSelfProfileResponse = z.infer<typeof adminSelfProfileResponseSchema>;

/** Server-scoped activity for the authenticated admin. */
export const adminSelfProfileActivityResponseSchema = adminPaginated(adminAuditLogEntrySchema);
export type AdminSelfProfileActivityResponse = z.infer<
  typeof adminSelfProfileActivityResponseSchema
>;

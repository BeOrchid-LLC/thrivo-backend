import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../middleware/require-auth";
import { requestUploadPayloadSchema } from "../../contracts/src/uploads";
import { requestUploadUrl, verifyUploadUrl } from "../controllers/uploads.controller";
import { validate } from "../middleware/validate";
import type { AppEnv } from "../types/http";

const verifyParamSchema = z.object({ id: z.string().uuid() });

/** `/api/v1/uploads` — generic presigned-upload surface (avatars now; photos later). */
export const uploadsRouter = new Hono<AppEnv>();

uploadsRouter.use(requireAuth);
uploadsRouter.post(
  "/presigned-url",
  validate("json", requestUploadPayloadSchema),
  requestUploadUrl
);
uploadsRouter.post("/:id/verify", validate("param", verifyParamSchema), verifyUploadUrl);

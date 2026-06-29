import type { Context } from "hono";
import { requestUploadPayloadSchema } from "../../contracts/src/uploads";
import { respondOk } from "../lib/response";
import { getValidatedInput } from "../middleware/validate";
import { confirmUpload, requestUpload } from "../services/uploads.service";
import type { AppEnv } from "../types/http";

/** POST /uploads/presigned-url — mint a presigned PUT URL for a direct client→R2 upload. */
export async function requestUploadUrl(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const input = requestUploadPayloadSchema.parse(getValidatedInput(c, "json"));
  const result = await requestUpload(user, input);
  return respondOk(c, result, "Presigned URL generated");
}

/** POST /uploads/:id/verify — confirm the upload landed in R2 and mark it verified. */
export async function verifyUploadUrl(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const { id } = getValidatedInput(c, "param") as { id: string };
  const result = await confirmUpload(user, id);
  return respondOk(c, result, "Upload verified");
}

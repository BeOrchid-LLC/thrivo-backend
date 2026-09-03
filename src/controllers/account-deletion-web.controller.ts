import type { Context } from "hono";
import { getValidatedInput } from "../middleware/validate";
import { respondOk } from "../lib/response";
import {
  confirmWebAccountDeletion,
  requestWebAccountDeletion,
} from "../services/account-deletion-web.service";
import type { AppEnv } from "../types/http";

export async function requestAccountDeletion(c: Context<AppEnv>) {
  await requestWebAccountDeletion(getValidatedInput(c, "json"));
  return respondOk(
    c,
    null,
    "If a Thrivo account uses this email, a confirmation email has been sent.",
    202
  );
}

export async function confirmAccountDeletion(c: Context<AppEnv>) {
  const result = await confirmWebAccountDeletion(getValidatedInput(c, "json"));
  return respondOk(c, result, "Account deletion is queued.", 202);
}

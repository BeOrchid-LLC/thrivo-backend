import type { Context } from "hono";
import { z } from "zod";
import { respondOk } from "../lib/response";
import {
  disableWeeklyReviewEmail,
  getWeeklyReviewPreference,
} from "../services/email-preference.service";
import type { AppEnv } from "../types/http";

const tokenSchema = z.string().min(20).max(4_096);

export async function getWeeklyReviewEmailPreference(c: Context<AppEnv>) {
  const token = tokenSchema.parse(c.req.query("token"));
  return respondOk(c, await getWeeklyReviewPreference(token));
}

export async function postDisableWeeklyReviewEmail(c: Context<AppEnv>) {
  const body = z.object({ token: tokenSchema }).parse(await c.req.json());
  return respondOk(c, await disableWeeklyReviewEmail(body.token), "Weekly review email disabled");
}

export async function postOneClickWeeklyReviewUnsubscribe(c: Context<AppEnv>) {
  const token = tokenSchema.parse(c.req.query("token"));
  return respondOk(c, await disableWeeklyReviewEmail(token), "Weekly review email disabled");
}

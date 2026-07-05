import type { Context } from "hono";
import { leadCapturePayloadSchema } from "../../contracts/src/leads";
import { respondOk } from "../lib/response";
import { getValidatedInput } from "../middleware/validate";
import { parseUserAgent } from "../lib/user-agent";
import { emailCaptureRepo } from "../repositories";
import type { AppEnv } from "../types/http";

const RAW_USER_AGENT_MAX = 512;
const REFERRER_MAX = 2048;

/**
 * POST /leads/capture — public, unauthenticated. Enriches the submission with
 * request-derived marketing metadata that needs no browser permission: country
 * (Cloudflare's cf-ipcountry edge header), device/OS/browser (parsed from
 * User-Agent), referrer, and UTM params from the payload. The response is
 * identical on first submission and every resubmission (see
 * emailCaptureRepo.capture) — never reveals whether an email already exists.
 */
export async function postCaptureLead(c: Context<AppEnv>) {
  const body = leadCapturePayloadSchema.parse(getValidatedInput(c, "json"));

  const ua = parseUserAgent(c.req.header("user-agent"));
  const country = c.req.header("cf-ipcountry") ?? null;
  const rawUserAgent = c.req.header("user-agent")?.slice(0, RAW_USER_AGENT_MAX) ?? null;
  const referrer = c.req.header("referer")?.slice(0, REFERRER_MAX) ?? null;

  await emailCaptureRepo.capture({
    email: body.email,
    source: body.source,
    country,
    deviceType: ua.deviceType,
    osName: ua.osName,
    osVersion: ua.osVersion,
    browserName: ua.browserName,
    browserVersion: ua.browserVersion,
    rawUserAgent,
    referrer,
    utmSource: body.utmSource ?? null,
    utmMedium: body.utmMedium ?? null,
    utmCampaign: body.utmCampaign ?? null,
  });

  return respondOk(c, { captured: true }, "Thanks — we'll notify you at launch.");
}

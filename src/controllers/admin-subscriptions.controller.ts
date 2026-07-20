import type { Context } from "hono";
import { z } from "zod";
import { respondOk } from "../lib/response";
import { buildOffsetMeta, parseOffset } from "../lib/pagination";
import { adminSubscriptionRepo } from "../repositories";
import type { AppEnv } from "../types/http";

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  // Admin status tab. `all`/absent => no filter. `none` isn't a real row state
  // in this table, so it simply matches nothing.
  status: z.enum(["all", "active", "trialing", "canceled", "expired", "none"]).optional(),
  q: z.string().optional(),
});

/** GET /admin/subscriptions — offset-paginated subscription list, status-tab filtered. */
export async function listAdminSubscriptions(c: Context<AppEnv>) {
  const { page, pageSize, status, q } = listQuerySchema.parse(c.req.query());
  const params = parseOffset(page, pageSize);

  // `none` = users with no subscription at all; there is no such row in the
  // subscriptions table, so this tab is always empty (the user-detail view is
  // where a subscription-less user shows up).
  if (status === "none") {
    return respondOk(c, {
      items: [],
      pagination: buildOffsetMeta(params.page, params.pageSize, 0),
    });
  }

  const { rows, total } = await adminSubscriptionRepo.listPaged({
    offset: params.offset,
    limit: params.pageSize,
    status: status && status !== "all" ? status : undefined,
    q,
  });
  return respondOk(c, {
    items: rows,
    pagination: buildOffsetMeta(params.page, params.pageSize, total),
  });
}

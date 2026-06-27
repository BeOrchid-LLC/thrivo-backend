import { Hono } from "hono";
import {
  addFavoritePayloadSchema,
  deleteLogParamsSchema,
  estimateFoodPayloadSchema,
  favoriteParamsSchema,
  foodDetailParamsSchema,
  foodLogDayQuerySchema,
  foodLogHistoryQuerySchema,
  foodLookupQuerySchema,
  foodSearchQuerySchema,
  logEstimatePayloadSchema,
  logFoodPayloadSchema,
  recentFoodsQuerySchema,
  updateLogPayloadSchema,
  upsertFoodPayloadSchema,
} from "../../contracts/src/foods";
import {
  createEstimateLog,
  createFavorite,
  createFoodItem,
  createFoodLog,
  deleteFavorite,
  estimateFoodEntry,
  getFavorites,
  getFoodItem,
  getFoodLogDay,
  getFoodLogHistory,
  getRecentFoods,
  lookupFoodByBarcode,
  patchFoodLog,
  removeFoodLog,
  searchFoodItems,
  updateFoodItem,
} from "../controllers/foods.controller";
import { requireAuth } from "../middleware/require-auth";
import { validate } from "../middleware/validate";
import type { AppEnv } from "../types/http";

export const foodsRouter = new Hono<AppEnv>();

foodsRouter.use(requireAuth);
foodsRouter.get("/lookup", validate("query", foodLookupQuerySchema), lookupFoodByBarcode);
foodsRouter.get("/search", validate("query", foodSearchQuerySchema), searchFoodItems);
foodsRouter.post("/estimate", validate("json", estimateFoodPayloadSchema), estimateFoodEntry);
foodsRouter.post("/log/estimate", validate("json", logEstimatePayloadSchema), createEstimateLog);
foodsRouter.post("/log", validate("json", logFoodPayloadSchema), createFoodLog);
foodsRouter.patch(
  "/log/:id",
  validate("param", deleteLogParamsSchema),
  validate("json", updateLogPayloadSchema),
  patchFoodLog
);
foodsRouter.delete("/log/:id", validate("param", deleteLogParamsSchema), removeFoodLog);
foodsRouter.get("/log/day", validate("query", foodLogDayQuerySchema), getFoodLogDay);
foodsRouter.get("/log/history", validate("query", foodLogHistoryQuerySchema), getFoodLogHistory);
foodsRouter.get("/recent", validate("query", recentFoodsQuerySchema), getRecentFoods);
foodsRouter.get("/favorites", getFavorites);
foodsRouter.post("/favorites", validate("json", addFavoritePayloadSchema), createFavorite);
foodsRouter.delete("/favorites/:id", validate("param", favoriteParamsSchema), deleteFavorite);
foodsRouter.post("/", validate("json", upsertFoodPayloadSchema), createFoodItem);
foodsRouter.get("/:id", validate("param", foodDetailParamsSchema), getFoodItem);
foodsRouter.patch(
  "/:id",
  validate("param", foodDetailParamsSchema),
  validate("json", upsertFoodPayloadSchema),
  updateFoodItem
);

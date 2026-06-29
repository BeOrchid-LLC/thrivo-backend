import {
  userRepo,
  foodItemRepo,
  foodLogRepo,
  weightEntryRepo,
  waterIntakeRepo,
  checkInRepo,
} from "../../src/repositories";
import { newId } from "../../src/lib/ids";
import type {
  NewUserRow,
  NewFoodItemRow,
  NewFoodLogRow,
  NewWeightEntryRow,
  NewWaterIntakeRow,
  NewCheckInRow,
} from "../../db/schema";

/** Unique, collision-free email for a fresh test user. */
export const uniqueEmail = (): string => `${newId()}@test.thrivo.fit`;

export const makeUser = (overrides: Partial<NewUserRow> = {}) =>
  userRepo.createUser({ email: uniqueEmail(), name: "Test User", ...overrides });

export const makeFoodItem = (overrides: Partial<NewFoodItemRow> = {}) =>
  foodItemRepo.insertItem({
    tier: "personal",
    origin: "personal",
    name: "Test Food",
    ...overrides,
  });

export const makeFoodLog = (userId: string, overrides: Partial<NewFoodLogRow> = {}) =>
  foodLogRepo.createLog({
    userId,
    loggedAt: new Date(),
    consumedAt: new Date(),
    localDate: "2026-06-10",
    source: "manual",
    name: "Test Food",
    servingQty: "1",
    kcal: 100,
    proteinG: "1",
    carbsG: "1",
    fatG: "1",
    ...overrides,
  });

export const makeWeightEntry = (userId: string, overrides: Partial<NewWeightEntryRow> = {}) =>
  weightEntryRepo.createEntry({
    userId,
    weightKg: "80.0",
    localDate: "2026-06-10",
    recordedAt: new Date(),
    ...overrides,
  });

export const makeWaterEntry = (userId: string, overrides: Partial<NewWaterIntakeRow> = {}) =>
  waterIntakeRepo.addEntry({
    userId,
    localDate: "2026-06-10",
    amountMl: 250,
    recordedAt: new Date(),
    ...overrides,
  });

export const makeCheckIn = (userId: string, overrides: Partial<NewCheckInRow> = {}) =>
  checkInRepo.createCheckIn({
    userId,
    localDate: "2026-06-10",
    mood: "good",
    ...overrides,
  });

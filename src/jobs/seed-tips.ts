import { tipRepo } from "../repositories";
import type { NewTipRow } from "../../db/schema";
import { logger } from "../lib/logger";

/**
 * Starter psychology-tip bank so the daily nudge works the moment the worker
 * boots, before staff curate the bank in the admin panel. Short, supportive,
 * habit-focused — no medical or prescriptive claims.
 */
export const STARTER_TIPS: NewTipRow[] = [
  { body: "Logging one meal today beats logging none perfectly. Progress over perfection." },
  { body: "Hungry or just bored? Pause for a glass of water and check again in 10 minutes." },
  { body: "You don't have to earn your food. Fuel first, judge never." },
  { body: "A protein-forward breakfast keeps cravings quieter for the rest of the day." },
  { body: "Missed a day? The streak that matters is the one you restart today." },
  { body: "Slow down at meals — your fullness signal runs about 20 minutes behind your fork." },
  { body: "Swap 'I blew it' for 'I noticed it.' Awareness is the whole skill." },
  { body: "Stand up and stretch for two minutes. Movement counts even when it's small." },
  { body: "Plan tomorrow's first meal tonight — decisions are easier before you're hungry." },
  { body: "Thirst often masquerades as hunger. Aim for a glass of water with every meal." },
  { body: "One vegetable on the plate is a win. Two is a celebration." },
  { body: "Sleep is a nutrition tool: a rested brain makes calmer food choices." },
  { body: "Compare yourself to last week, not to anyone else. Your pace is the right pace." },
  { body: "Cravings pass like weather. Notice it, ride it out, let it move on." },
  { body: "Be the friend to yourself that you'd be to someone else starting out today." },
];

/** Idempotent — seeds the starter bank only when the tips table is empty. */
export async function seedStarterTips(): Promise<number> {
  const existing = await tipRepo.countAll();
  logger.info({ existing }, "starter tips count checked");
  if (existing > 0) {
    logger.info("starter tips seed skipped: bank already populated");
    return 0;
  }
  await tipRepo.insertMany(STARTER_TIPS);
  logger.info({ inserted: STARTER_TIPS.length }, "starter tips inserted");
  return STARTER_TIPS.length;
}

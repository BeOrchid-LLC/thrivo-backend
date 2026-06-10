import { uuidv7 } from "uuidv7";

/**
 * Single, swappable source of primary-key ids. UUIDv7 is time-sortable (good
 * B-tree locality) and generatable app-side without a DB round trip.
 */
export const newId = (): string => uuidv7();

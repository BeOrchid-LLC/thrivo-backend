import { desc, eq } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import { leadNotes, type LeadNoteRow } from "../../db/schema";

export async function listForLead(leadId: string, tx: Executor = db): Promise<LeadNoteRow[]> {
  return tx
    .select()
    .from(leadNotes)
    .where(eq(leadNotes.leadId, leadId))
    .orderBy(desc(leadNotes.createdAt));
}

export async function create(
  input: { leadId: string; authorAdminEmail: string; body: string },
  tx: Executor = db
): Promise<LeadNoteRow> {
  const [row] = await tx.insert(leadNotes).values(input).returning();
  return row;
}

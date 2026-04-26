import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Followups cron handler — currently NOT scheduled in vercel.json.
 *
 * The previous implementation called createActivity() with a contract
 * that has since drifted (subject/note/dueDate not in CreateActivityParams,
 * userId allowed undefined, missing quoteReference). It would have failed
 * at runtime if scheduled.
 *
 * The original code is preserved in Git history at commit 290bca2 (main
 * tip pre-typecheck PR). Reactivating this cron requires:
 *   1. Aligning the createActivity call to the current contract
 *   2. Defining what quoteReference should be for cron-generated activities
 *   3. Confirming the desired subject/note/dueDate semantics
 *   4. Wiring the cron schedule into vercel.json
 *
 * Until then, this handler returns 501 to make the unimplemented status
 * explicit if anyone accidentally invokes it.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  return res.status(501).json({
    error: 'not_implemented',
    message: 'Followups cron is unimplemented pending contract refactor. See file header.',
  });
}

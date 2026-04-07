import { NextRequest, NextResponse } from "next/server";
import { getSupabase, fetchAll } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const { dryRun = true } = await req.json().catch(() => ({ dryRun: true }));
  const db = getSupabase();

  // Fetch all transactions with match groups
  const allTxns = await fetchAll(
    "transactions",
    "id, date, amount, direction, account, account_name, bank, match_group, flag, description, category"
  );

  const active = allTxns.filter(t => t.flag !== "disqualified");

  // Group by match_group
  const groups: Record<string, any[]> = {};
  for (const t of active) {
    if (!t.match_group || t.match_group === "") continue;
    if (!groups[t.match_group]) groups[t.match_group] = [];
    groups[t.match_group].push(t);
  }

  const fixes: Array<{ id: number; oldDirection: string; newDirection: string; reason: string; description: string; account: string; bank: string; amount: number }> = [];

  for (const [group, txns] of Object.entries(groups)) {
    if (txns.length < 2) continue;

    // Find deposits (positive) and withdrawals (negative) in the group
    const deposits = txns.filter(t => (t.amount || 0) > 0);
    const withdrawals = txns.filter(t => (t.amount || 0) < 0);

    for (const dep of deposits) {
      for (const wth of withdrawals) {
        const depBank = (dep.bank || "").toLowerCase();
        const wthBank = (wth.bank || "").toLowerCase();

        // Cross-bank transfer: different banks
        const isCrossBank = depBank !== wthBank && depBank !== "" && wthBank !== "";

        if (isCrossBank) {
          // The deposit (receiving) side should be Contribution, not Internal Transfer
          if ((dep.direction || "").toLowerCase() === "internal transfer") {
            fixes.push({
              id: dep.id,
              oldDirection: dep.direction,
              newDirection: "Contribution",
              reason: `Cross-bank deposit from ${wthBank} → ${depBank} should be Contribution`,
              description: dep.description || "",
              account: dep.account || dep.account_name || "",
              bank: dep.bank || "",
              amount: dep.amount,
            });
          }

          // The withdrawal (sending) side should be Internal Transfer (since money went to another owned account)
          if ((wth.direction || "").toLowerCase() !== "internal transfer") {
            fixes.push({
              id: wth.id,
              oldDirection: wth.direction || "",
              newDirection: "Internal Transfer",
              reason: `Cross-bank withdrawal from ${wthBank} → ${depBank} should be Internal Transfer (went to owned account)`,
              description: wth.description || "",
              account: wth.account || wth.account_name || "",
              bank: wth.bank || "",
              amount: wth.amount,
            });
          }
        }
      }
    }
  }

  if (dryRun) {
    return NextResponse.json({
      message: `Found ${fixes.length} direction fixes needed (dry run)`,
      fixes,
      dryRun: true,
    });
  }

  // Apply fixes
  let applied = 0;
  for (const fix of fixes) {
    const { error } = await db
      .from("transactions")
      .update({ direction: fix.newDirection })
      .eq("id", fix.id);
    if (!error) applied++;
  }

  return NextResponse.json({
    message: `Applied ${applied} of ${fixes.length} direction fixes`,
    fixes,
    applied,
    dryRun: false,
  });
}

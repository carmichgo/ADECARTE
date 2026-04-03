import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const db = getSupabase();
  const { data: txns, error } = await db
    .from("transactions")
    .select("id, date, amount, direction, account, account_name, bank, counterparty, description, flag, category")
    .neq("flag", "disqualified")
    .order("date", { ascending: true })
    .limit(10000);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!txns || txns.length === 0) return NextResponse.json({ flows: [], matches: [], unmatched: [], banks: [] });

  // Separate outflows and inflows by bank
  const banks = [...new Set(txns.map(t => t.bank || "Unknown").filter(Boolean))].sort();

  // Build aggregate flows between banks
  const flowMap: Record<string, { from: string; to: string; amount: number; count: number }> = {};

  // Auto-match: withdrawal from Bank A → deposit into Bank B
  const outflows = txns.filter(t => (t.amount || 0) < 0 && !(t.direction || "").toLowerCase().match(/internal|transfer between/));
  const inflows = txns.filter(t => (t.amount || 0) > 0 && !(t.direction || "").toLowerCase().match(/internal|transfer between/));

  const matches: Array<{
    source: any; dest: any; confidence: number; match_type: string; amount_diff: number; day_diff: number;
  }> = [];
  const matchedSourceIds = new Set<number>();
  const matchedDestIds = new Set<number>();

  // Match outflows to inflows across different banks
  for (const out of outflows) {
    const outAmount = Math.abs(out.amount);
    const outDate = new Date(out.date).getTime();
    const outBank = out.bank || "Unknown";
    if (isNaN(outDate)) continue;

    let bestMatch: any = null;
    let bestScore = 0;

    for (const inf of inflows) {
      if (matchedDestIds.has(inf.id)) continue;
      const infBank = inf.bank || "Unknown";
      if (infBank === outBank) continue; // Same bank = not a cross-bank transfer

      const infAmount = Math.abs(inf.amount);
      const infDate = new Date(inf.date).getTime();
      if (isNaN(infDate)) continue;

      const dayDiff = Math.abs(infDate - outDate) / (1000 * 60 * 60 * 24);
      if (dayDiff > 5) continue; // Max 5 day window

      const amountDiff = Math.abs(outAmount - infAmount) / Math.max(outAmount, 1);
      if (amountDiff > 0.02) continue; // Max 2% difference

      // Score: higher = better match
      let score = 0;
      if (amountDiff === 0) score += 50; // Exact amount
      else score += 30 * (1 - amountDiff / 0.02);

      if (dayDiff === 0) score += 40; // Same day
      else if (dayDiff <= 1) score += 30;
      else if (dayDiff <= 3) score += 15;
      else score += 5;

      // Bonus for counterparty/description hints
      const outDesc = (out.description || "").toLowerCase();
      const infDesc = (inf.description || "").toLowerCase();
      if (outDesc.includes(infBank.toLowerCase()) || infDesc.includes(outBank.toLowerCase())) score += 10;

      if (score > bestScore) {
        bestScore = score;
        bestMatch = { inf, score, amountDiff, dayDiff };
      }
    }

    if (bestMatch && bestScore >= 30) {
      const confidence = Math.min(bestScore / 100, 0.99);
      matches.push({
        source: { id: out.id, date: out.date, amount: out.amount, bank: outBank, account: out.account || out.account_name, description: out.description, counterparty: out.counterparty, flag: out.flag },
        dest: { id: bestMatch.inf.id, date: bestMatch.inf.date, amount: bestMatch.inf.amount, bank: bestMatch.inf.bank || "Unknown", account: bestMatch.inf.account || bestMatch.inf.account_name, description: bestMatch.inf.description, counterparty: bestMatch.inf.counterparty, flag: bestMatch.inf.flag },
        confidence,
        match_type: confidence > 0.8 ? "high" : confidence > 0.5 ? "medium" : "low",
        amount_diff: bestMatch.amountDiff,
        day_diff: bestMatch.dayDiff,
      });
      matchedSourceIds.add(out.id);
      matchedDestIds.add(bestMatch.inf.id);

      // Add to flow map
      const flowKey = `${outBank}→${bestMatch.inf.bank || "Unknown"}`;
      if (!flowMap[flowKey]) flowMap[flowKey] = { from: outBank, to: bestMatch.inf.bank || "Unknown", amount: 0, count: 0 };
      flowMap[flowKey].amount += Math.abs(out.amount);
      flowMap[flowKey].count++;
    }
  }

  // Also track flows within same bank to external parties
  for (const out of outflows) {
    if (matchedSourceIds.has(out.id)) continue;
    const outBank = out.bank || "Unknown";
    const dest = out.counterparty || "Unknown External";
    const flowKey = `${outBank}→${dest}`;
    if (!flowMap[flowKey]) flowMap[flowKey] = { from: outBank, to: dest, amount: 0, count: 0 };
    flowMap[flowKey].amount += Math.abs(out.amount);
    flowMap[flowKey].count++;
  }

  // Unmatched cross-bank candidates
  const unmatched = outflows
    .filter(t => !matchedSourceIds.has(t.id))
    .map(t => ({ id: t.id, date: t.date, amount: t.amount, bank: t.bank || "Unknown", account: t.account || t.account_name, description: t.description, counterparty: t.counterparty, flag: t.flag }))
    .slice(0, 200);

  const flows = Object.values(flowMap)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 50);

  return NextResponse.json({
    flows,
    matches: matches.sort((a, b) => b.confidence - a.confidence),
    unmatched,
    banks,
    stats: {
      total_matched: matches.length,
      total_matched_amount: matches.reduce((s, m) => s + Math.abs(m.source.amount), 0),
      total_unmatched: unmatched.length,
      high_confidence: matches.filter(m => m.match_type === "high").length,
      medium_confidence: matches.filter(m => m.match_type === "medium").length,
      low_confidence: matches.filter(m => m.match_type === "low").length,
    },
  });
}

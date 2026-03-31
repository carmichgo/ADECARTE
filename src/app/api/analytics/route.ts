import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getSupabase();
    const { data: txns, error } = await db
      .from("transactions")
      .select("id, date, amount, direction, account, account_name, description, counterparty, symbol, security, category, flag")
      .order("date", { ascending: true })
      .limit(10000);

    if (error) {
      console.error("Analytics query error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!txns || txns.length === 0) {
      return NextResponse.json({
        balance_over_time: [],
        balance_by_account: {},
        transaction_counts: [],
      });
    }

    // ── 1. Overall balance over time ─────────────────────────────────
    // Group transactions by date, compute cumulative balance
    const byDate: Record<string, { date: string; inflow: number; outflow: number; net: number; count: number }> = {};

    for (const t of txns) {
      const d = t.date || "Unknown";
      if (!byDate[d]) byDate[d] = { date: d, inflow: 0, outflow: 0, net: 0, count: 0 };

      const amount = t.amount || 0;
      const dir = (t.direction || "").toLowerCase();
      const isIncoming = dir.match(/^(buy|in|incoming|deposit|credit|receive)/) || amount > 0;

      if (isIncoming && amount > 0) {
        byDate[d].inflow += Math.abs(amount);
      } else {
        byDate[d].outflow += Math.abs(amount);
      }
      byDate[d].net += amount;
      byDate[d].count++;
    }

    const sortedDates = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
    let cumBalance = 0;
    const balanceOverTime = sortedDates.map(d => {
      cumBalance += d.net;
      return {
        date: d.date,
        balance: cumBalance,
        inflow: d.inflow,
        outflow: d.outflow,
        net: d.net,
        count: d.count,
      };
    });

    // ── 2. Balance over time by account ──────────────────────────────
    const accountMap: Record<string, Record<string, number>> = {};

    for (const t of txns) {
      const acct = t.account_name || t.account || "Unknown";
      const d = t.date || "Unknown";
      if (!accountMap[acct]) accountMap[acct] = {};
      if (!accountMap[acct][d]) accountMap[acct][d] = 0;
      accountMap[acct][d] += t.amount || 0;
    }

    const balanceByAccount: Record<string, Array<{ date: string; balance: number; daily_net: number }>> = {};
    for (const [acct, dateAmounts] of Object.entries(accountMap)) {
      const sorted = Object.entries(dateAmounts).sort((a, b) => a[0].localeCompare(b[0]));
      let cum = 0;
      balanceByAccount[acct] = sorted.map(([date, net]) => {
        cum += net;
        return { date, balance: cum, daily_net: net };
      });
    }

    // ── 3. Transaction counts by counterparty/description (in vs out) ─
    const partyCounts: Record<string, { party: string; deposits: number; deposit_amount: number; withdrawals: number; withdrawal_amount: number }> = {};

    for (const t of txns) {
      // Use counterparty if available, else first meaningful part of description
      const party = t.counterparty || extractParty(t.description) || "Unknown";
      if (!partyCounts[party]) {
        partyCounts[party] = { party, deposits: 0, deposit_amount: 0, withdrawals: 0, withdrawal_amount: 0 };
      }

      const amount = t.amount || 0;
      const dir = (t.direction || "").toLowerCase();
      const isIncoming = dir.match(/^(buy|in|incoming|deposit|credit|receive)/) || amount > 0;

      if (isIncoming && amount > 0) {
        partyCounts[party].deposits++;
        partyCounts[party].deposit_amount += Math.abs(amount);
      } else {
        partyCounts[party].withdrawals++;
        partyCounts[party].withdrawal_amount += Math.abs(amount);
      }
    }

    // Sort by total transaction count
    const transactionCounts = Object.values(partyCounts)
      .sort((a, b) => (b.deposits + b.withdrawals) - (a.deposits + a.withdrawals))
      .slice(0, 50); // Top 50

    return NextResponse.json({
      balance_over_time: balanceOverTime,
      balance_by_account: balanceByAccount,
      transaction_counts: transactionCounts,
    });
  } catch (err: any) {
    console.error("Analytics error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function extractParty(description: string | null): string {
  if (!description) return "";
  // Take first 40 chars or up to first common separator
  const cleaned = description.replace(/\s+/g, " ").trim();
  const cut = cleaned.match(/^(.{3,40?})(?:\s*[-|\/\\,;]|\s{2,})/);
  return cut ? cut[1].trim() : cleaned.slice(0, 40).trim();
}

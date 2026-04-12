import { NextRequest, NextResponse } from "next/server";
import { getSupabase, fetchAll } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const txns = await fetchAll("transactions", "id, date, amount, direction, account, account_name, bank, description, counterparty, beneficiary, symbol, security, category, flag, unit_price, quantity, strategy, settle_date", q => q.order("date", { ascending: true }));

    if (!txns || txns.length === 0) {
      return NextResponse.json({
        balance_over_time: [],
        balance_by_account: {},
        transaction_counts: [],
        raw_transactions: [],
      });
    }

    // Exclude disqualified from all analytics
    const activeTxns = txns.filter(t => t.flag !== "disqualified");

    // ── 1. Overall balance over time ─────────────────────────────────
    const byDate: Record<string, { date: string; raw_date: string; inflow: number; outflow: number; net: number; count: number; withdraw_count: number; withdraw_total: number }> = {};

    for (const t of activeTxns) {
      const d = t.date || "Unknown";
      if (!byDate[d]) byDate[d] = { date: d, raw_date: d, inflow: 0, outflow: 0, net: 0, count: 0, withdraw_count: 0, withdraw_total: 0 };

      const amount = t.amount || 0;

      if (excludeFromFlow(t)) {
        byDate[d].count++;
        continue;
      }
      if (amount > 0) {
        byDate[d].inflow += Math.abs(amount);
      } else if (amount < 0) {
        byDate[d].outflow += Math.abs(amount);
        byDate[d].withdraw_count++;
        byDate[d].withdraw_total += Math.abs(amount);
      }
      byDate[d].net += amount;
      byDate[d].count++;
    }

    const sortedDates = Object.values(byDate).sort((a, b) => {
      const da = new Date(a.date).getTime();
      const dbt = new Date(b.date).getTime();
      if (isNaN(da) && isNaN(dbt)) return a.date.localeCompare(b.date);
      if (isNaN(da)) return 1;
      if (isNaN(dbt)) return -1;
      return da - dbt;
    });

    let cumBalance = 0;
    const balanceOverTime = sortedDates.map(d => {
      cumBalance += d.net;
      const parsed = new Date(d.date);
      const label = isNaN(parsed.getTime()) ? d.date : parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
      return {
        date: label,
        raw_date: d.raw_date,
        balance: cumBalance,
        inflow: d.inflow,
        outflow: d.outflow,
        net: d.net,
        count: d.count,
        withdraw_count: d.withdraw_count,
        withdraw_total: d.withdraw_total,
      };
    });

    // ── 2. Balance over time by account ──────────────────────────────
    const accountMap: Record<string, Record<string, number>> = {};
    for (const t of activeTxns) {
      if (excludeFromFlow(t)) continue;
      const acct = t.account || t.account_name || "Unknown";
      const d = t.date || "Unknown";
      if (!accountMap[acct]) accountMap[acct] = {};
      if (!accountMap[acct][d]) accountMap[acct][d] = 0;
      accountMap[acct][d] += t.amount || 0;
    }

    const balanceByAccount: Record<string, Array<{ date: string; balance: number; daily_net: number }>> = {};
    for (const [acct, dateAmounts] of Object.entries(accountMap)) {
      const sorted = Object.entries(dateAmounts).sort((a, b) => {
        const da = new Date(a[0]).getTime();
        const dbt = new Date(b[0]).getTime();
        if (isNaN(da) && isNaN(dbt)) return a[0].localeCompare(b[0]);
        if (isNaN(da)) return 1;
        if (isNaN(dbt)) return -1;
        return da - dbt;
      });
      let cum = 0;
      balanceByAccount[acct] = sorted.map(([date, net]) => {
        cum += net;
        const parsed = new Date(date);
        const label = isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
        return { date: label, balance: cum, daily_net: net };
      });
    }

    // ── 3. Transaction counts by counterparty ────────────────────────
    const partyCounts: Record<string, { party: string; deposits: number; deposit_amount: number; withdrawals: number; withdrawal_amount: number; internal: number; internal_amount: number }> = {};
    for (const t of activeTxns) {
      const party = t.counterparty || extractParty(t.description) || "Unknown";
      if (!partyCounts[party]) {
        partyCounts[party] = { party, deposits: 0, deposit_amount: 0, withdrawals: 0, withdrawal_amount: 0, internal: 0, internal_amount: 0 };
      }
      const amount = t.amount || 0;
      if (excludeFromFlow(t)) { partyCounts[party].internal++; partyCounts[party].internal_amount += Math.abs(amount); }
      else if (amount > 0) { partyCounts[party].deposits++; partyCounts[party].deposit_amount += Math.abs(amount); }
      else if (amount < 0) { partyCounts[party].withdrawals++; partyCounts[party].withdrawal_amount += Math.abs(amount); }
    }
    const transactionCounts = Object.values(partyCounts)
      .sort((a, b) => (b.deposits + b.withdrawals) - (a.deposits + a.withdrawals))
      .slice(0, 50);

    // ── 4. Raw transactions for AI analysis ──────────────────────────
    const rawForAi = txns.map(t => ({
      id: t.id, date: t.date, amount: t.amount, direction: t.direction,
      account: t.account || t.account_name, description: t.description,
      counterparty: t.counterparty, symbol: t.symbol, security: t.security,
      category: t.category, flag: t.flag, strategy: t.strategy, beneficiary: t.beneficiary,
    }));

    // ── 5. Verified fraud transactions for impact analysis ─────────
    const fraudTxns = txns
      .filter(t => t.flag === "verified_fraud"
        && (t.amount || 0) < 0
        && (t.direction || "").toLowerCase() === "withdraw"
        && (t.category || "").toLowerCase() !== "unauthorized interbank transfer")
      .map(t => ({
        id: t.id, date: t.date, amount: Math.abs(t.amount || 0),
        description: t.description, counterparty: t.counterparty,
        account: t.account || t.account_name, bank: t.bank || "",
        strategy: t.strategy || "", beneficiary: t.beneficiary || "",
        flag: t.flag || "",
      }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // ── 6. Normal flag flow transactions for present value analysis ─────────
    const isExcludedPV = (t: any) => {
      return (t.direction || "").toLowerCase() === "internal transfer";
    };
    const pvTransactions = activeTxns
      .filter(t => !isExcludedPV(t) && (!t.flag || t.flag === "normal"))
      .map(t => ({
        id: t.id, date: t.date, amount: t.amount || 0,
        description: t.description, counterparty: t.counterparty,
        account: t.account || t.account_name, bank: t.bank || "",
        direction: t.direction || "", beneficiary: t.beneficiary || "",
        flag: t.flag || "", category: t.category || "",
      }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return NextResponse.json({
      balance_over_time: balanceOverTime,
      balance_by_account: balanceByAccount,
      transaction_counts: transactionCounts,
      fraud_transactions: fraudTxns,
      pv_transactions: pvTransactions,
      raw_transactions: rawForAi,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function excludeFromFlow(t: any): boolean {
  return (t.direction || "").toLowerCase() === "internal transfer";
}

function extractParty(description: string | null): string {
  if (!description) return "";
  const cleaned = description.replace(/\s+/g, " ").trim();
  const cut = cleaned.match(/^(.{3,40?})(?:\s*[-|\/\\,;]|\s{2,})/);
  return cut ? cut[1].trim() : cleaned.slice(0, 40).trim();
}

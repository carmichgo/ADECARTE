import { NextResponse } from "next/server";
import { getSupabase, fetchAll } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
  const all = await fetchAll("transactions", "id, amount, category, flag, categorized_by, account, account_name, bank, direction");

  // Exclude disqualified from all stats
  const active = all.filter(t => t.flag !== "disqualified");
  const isExcluded = (t: any) => {
    const dir = (t.direction || "").toLowerCase();
    return dir === "internal transfer";
  };
  const flowTxns = active.filter(t => !isExcluded(t)); // Only real contributions/withdrawals

  const total = active.length;
  const totalAmount = flowTxns.reduce((s, t) => s + (t.amount || 0), 0);
  const totalDeposits = flowTxns.filter(t => (t.amount || 0) > 0).reduce((s, t) => s + t.amount, 0);
  const totalWithdrawals = flowTxns.filter(t => (t.amount || 0) < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const depositCount = flowTxns.filter(t => (t.amount || 0) > 0).length;
  const withdrawalCount = flowTxns.filter(t => (t.amount || 0) < 0).length;
  const categorized = active.filter(t => t.category && t.category !== "").length;
  const uncategorized = total - categorized;
  const disqualifiedCount = all.filter(t => t.flag === "disqualified").length;

  // Line of Credit stats
  const locDrawnTxns = active.filter(t => (t.category || "") === "Line of Credit");
  const loanDisbursed = locDrawnTxns.reduce((s, t) => s + Math.abs(t.amount || 0), 0);
  // LOC Repaid = only principal repayments (reduces what you owe)
  const locPrincipalTxns = active.filter(t => (t.category || "") === "LOC Principal Repayment");
  const loanRepaid = locPrincipalTxns.reduce((s, t) => s + Math.abs(t.amount || 0), 0);
  const loanOutstanding = loanDisbursed - loanRepaid;
  // LOC Interest = cost of borrowing (does NOT reduce principal)
  const locInterestTxns = active.filter(t => (t.category || "") === "LOC Interest Payment");
  const loanInterest = locInterestTxns.reduce((s, t) => s + Math.abs(t.amount || 0), 0);
  const locTxns = [...locDrawnTxns, ...locPrincipalTxns, ...locInterestTxns];

  // Time Deposit stats
  const tdTxns = active.filter(t => (t.category || "").toLowerCase().match(/time deposit/));
  const tdPlaced = tdTxns.filter(t => (t.amount || 0) < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const tdMatured = tdTxns.filter(t => (t.amount || 0) > 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const tdActive = tdPlaced - tdMatured;
  const tdCount = tdTxns.length;
  const loanCount = locTxns.length;

  const suspiciousItems = active.filter(t =>
    t.flag === "suspicious" || t.flag === "critical" || t.flag === "verified_fraud" || (t.category && t.category.startsWith("SUSPICIOUS"))
  );
  const suspiciousAmount = suspiciousItems.reduce((s, t) => s + Math.abs(t.amount || 0), 0);
  const suspiciousCount = suspiciousItems.length;

  const verifiedFraudItems = active.filter(t => t.flag === "verified_fraud" && (t.amount || 0) < 0 && (t.direction || "").toLowerCase() === "withdraw");
  const verifiedFraudAmount = verifiedFraudItems.reduce((s, t) => s + Math.abs(t.amount || 0), 0);
  const verifiedFraudCount = verifiedFraudItems.length;

  // Group by category
  const byCategoryMap: Record<string, { count: number; total_amount: number }> = {};
  active.forEach(t => {
    if (!t.category) return;
    if (!byCategoryMap[t.category]) byCategoryMap[t.category] = { count: 0, total_amount: 0 };
    byCategoryMap[t.category].count++;
    byCategoryMap[t.category].total_amount += t.amount || 0;
  });
  const byCategory = Object.entries(byCategoryMap)
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => Math.abs(b.total_amount) - Math.abs(a.total_amount));

  // Group by flag
  const byFlagMap: Record<string, { count: number; total_amount: number }> = {};
  active.forEach(t => {
    if (!t.flag) return;
    if (!byFlagMap[t.flag]) byFlagMap[t.flag] = { count: 0, total_amount: 0 };
    byFlagMap[t.flag].count++;
    byFlagMap[t.flag].total_amount += t.amount || 0;
  });
  const byFlag = Object.entries(byFlagMap).map(([flag, v]) => ({ flag, ...v }));

  // Suspicious breakdown
  const suspBreakMap: Record<string, { category: string; flag: string; count: number; total_amount: number }> = {};
  suspiciousItems.forEach(t => {
    const key = `${t.category}|${t.flag}`;
    if (!suspBreakMap[key]) suspBreakMap[key] = { category: t.category || "", flag: t.flag || "", count: 0, total_amount: 0 };
    suspBreakMap[key].count++;
    suspBreakMap[key].total_amount += t.amount || 0;
  });
  const suspiciousBreakdown = Object.values(suspBreakMap).sort((a, b) => Math.abs(b.total_amount) - Math.abs(a.total_amount));

  // Group by account
  const byAccountMap: Record<string, { count: number; total_amount: number; deposits: number; deposit_amount: number; withdrawals: number; withdrawal_amount: number }> = {};
  active.forEach(t => {
    const acct = t.account || t.account_name || "Unknown";
    if (!byAccountMap[acct]) byAccountMap[acct] = { count: 0, total_amount: 0, deposits: 0, deposit_amount: 0, withdrawals: 0, withdrawal_amount: 0 };
    byAccountMap[acct].count++;
    byAccountMap[acct].total_amount += t.amount || 0;
    if ((t.amount || 0) > 0) { byAccountMap[acct].deposits++; byAccountMap[acct].deposit_amount += t.amount; }
    else if ((t.amount || 0) < 0) { byAccountMap[acct].withdrawals++; byAccountMap[acct].withdrawal_amount += Math.abs(t.amount); }
  });
  const byAccount = Object.entries(byAccountMap)
    .map(([account, v]) => ({ account, ...v }))
    .sort((a, b) => Math.abs(b.total_amount) - Math.abs(a.total_amount));

  return NextResponse.json({
    total_transactions: total,
    total_amount: totalAmount,
    total_deposits: totalDeposits,
    total_withdrawals: totalWithdrawals,
    deposit_count: depositCount,
    withdrawal_count: withdrawalCount,
    categorized,
    uncategorized,
    suspicious_amount: suspiciousAmount,
    suspicious_count: suspiciousCount,
    verified_fraud_amount: verifiedFraudAmount,
    verified_fraud_count: verifiedFraudCount,
    suspicious_breakdown: suspiciousBreakdown,
    by_category: byCategory,
    by_flag: byFlag,
    by_account: byAccount,
    loan_disbursed: loanDisbursed,
    loan_repaid: loanRepaid,
    loan_outstanding: loanOutstanding,
    loan_interest: loanInterest,
    loan_count: loanCount,
    td_placed: tdPlaced,
    td_matured: tdMatured,
    td_active: tdActive,
    td_count: tdCount,
  });
  } catch (err: any) {
    console.error("Stats error:", err);
    return NextResponse.json({ total_transactions: 0, total_amount: 0, categorized: 0, uncategorized: 0, suspicious_amount: 0, suspicious_count: 0, suspicious_breakdown: [], by_category: [], by_flag: [], by_account: [], verified_fraud_amount: 0, verified_fraud_count: 0, total_deposits: 0, total_withdrawals: 0, deposit_count: 0, withdrawal_count: 0, loan_disbursed: 0, loan_repaid: 0, loan_outstanding: 0, loan_count: 0, td_placed: 0, td_matured: 0, td_active: 0, td_count: 0 });
  }
}

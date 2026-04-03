import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const db = getSupabase();
  const { data: all } = await db.from("transactions").select("id, amount, category, flag, direction").limit(50000);
  if (!all) return NextResponse.json({ error: "no data" });

  const active = all.filter(t => t.flag !== "disqualified");

  const isExcluded = (t: any) => {
    const dir = (t.direction || "").toLowerCase();
    const cat = (t.category || "").toLowerCase();
    return dir.match(/internal|transfer between/) || cat.match(/transfer.*between|internal.*transfer/) || cat.match(/line of credit|loc principal|loc interest/) || cat.match(/time deposit/);
  };

  const flowTxns = active.filter(t => !isExcluded(t));
  const excludedTxns = active.filter(t => isExcluded(t));

  // DEPOSITS: all flow transactions with positive amount, grouped by category
  const depositsByCat: Record<string, { count: number; total: number }> = {};
  flowTxns.filter(t => (t.amount || 0) > 0).forEach(t => {
    const cat = t.category || "(empty)";
    if (!depositsByCat[cat]) depositsByCat[cat] = { count: 0, total: 0 };
    depositsByCat[cat].count++;
    depositsByCat[cat].total += t.amount;
  });

  // WITHDRAWALS: all flow transactions with negative amount, grouped by category
  const withdrawsByCat: Record<string, { count: number; total: number }> = {};
  flowTxns.filter(t => (t.amount || 0) < 0).forEach(t => {
    const cat = t.category || "(empty)";
    if (!withdrawsByCat[cat]) withdrawsByCat[cat] = { count: 0, total: 0 };
    withdrawsByCat[cat].count++;
    withdrawsByCat[cat].total += Math.abs(t.amount);
  });

  // EXCLUDED: grouped by category + direction
  const excludedBreakdown: Record<string, { count: number; total: number; direction: string }> = {};
  excludedTxns.forEach(t => {
    const key = `${t.category || "(empty)"} | dir:${t.direction || "(empty)"}`;
    if (!excludedBreakdown[key]) excludedBreakdown[key] = { count: 0, total: 0, direction: t.direction || "" };
    excludedBreakdown[key].count++;
    excludedBreakdown[key].total += t.amount || 0;
  });

  // ZERO amount transactions in flow
  const zeroInFlow = flowTxns.filter(t => (t.amount || 0) === 0).length;

  // Deposits by direction
  const depositsByDir: Record<string, { count: number; total: number }> = {};
  flowTxns.filter(t => (t.amount || 0) > 0).forEach(t => {
    const dir = t.direction || "(empty)";
    if (!depositsByDir[dir]) depositsByDir[dir] = { count: 0, total: 0 };
    depositsByDir[dir].count++;
    depositsByDir[dir].total += t.amount;
  });

  // Withdrawals by direction
  const withdrawsByDir: Record<string, { count: number; total: number }> = {};
  flowTxns.filter(t => (t.amount || 0) < 0).forEach(t => {
    const dir = t.direction || "(empty)";
    if (!withdrawsByDir[dir]) withdrawsByDir[dir] = { count: 0, total: 0 };
    withdrawsByDir[dir].count++;
    withdrawsByDir[dir].total += Math.abs(t.amount);
  });

  const sort = (obj: Record<string, any>) => Object.entries(obj).sort((a, b) => Math.abs(b[1].total) - Math.abs(a[1].total));

  return NextResponse.json({
    summary: {
      total_all: all.length,
      active: active.length,
      excluded: excludedTxns.length,
      in_flow: flowTxns.length,
      zero_amount_in_flow: zeroInFlow,
      total_deposits: flowTxns.filter(t => (t.amount || 0) > 0).reduce((s, t) => s + t.amount, 0),
      total_withdrawals: flowTxns.filter(t => (t.amount || 0) < 0).reduce((s, t) => s + Math.abs(t.amount), 0),
    },
    deposits_by_category: sort(depositsByCat),
    deposits_by_direction: sort(depositsByDir),
    withdrawals_by_category: sort(withdrawsByCat),
    withdrawals_by_direction: sort(withdrawsByDir),
    excluded_breakdown: sort(excludedBreakdown),
  });
}

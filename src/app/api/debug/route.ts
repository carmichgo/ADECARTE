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

  const excluded = active.filter(t => isExcluded(t));
  const flowTxns = active.filter(t => !isExcluded(t));

  // Breakdown of what's excluded and why
  const excludedByDir = active.filter(t => (t.direction || "").toLowerCase().match(/internal|transfer between/));
  const excludedByCatTransfer = active.filter(t => (t.category || "").toLowerCase().match(/transfer.*between|internal.*transfer/));
  const excludedByCatLOC = active.filter(t => (t.category || "").toLowerCase().match(/line of credit|loc principal|loc interest/));
  const excludedByCatTD = active.filter(t => (t.category || "").toLowerCase().match(/time deposit/));

  return NextResponse.json({
    total_all: all.length,
    total_active: active.length,
    disqualified: all.length - active.length,
    total_excluded: excluded.length,
    excluded_by_direction_internal: excludedByDir.length,
    excluded_by_cat_transfer: excludedByCatTransfer.length,
    excluded_by_cat_loc: excludedByCatLOC.length,
    excluded_by_cat_td: excludedByCatTD.length,
    flow_txns: flowTxns.length,
    flow_deposits: flowTxns.filter(t => (t.amount || 0) > 0).reduce((s, t) => s + t.amount, 0),
    flow_deposits_count: flowTxns.filter(t => (t.amount || 0) > 0).length,
    flow_withdrawals: flowTxns.filter(t => (t.amount || 0) < 0).reduce((s, t) => s + Math.abs(t.amount), 0),
    flow_withdrawals_count: flowTxns.filter(t => (t.amount || 0) < 0).length,
    // All positive amounts (no exclusion)
    all_positive: active.filter(t => (t.amount || 0) > 0).reduce((s, t) => s + t.amount, 0),
    all_positive_count: active.filter(t => (t.amount || 0) > 0).length,
    // Unique categories
    categories: [...new Set(all.map(t => t.category || "(empty)"))].sort(),
    // Unique directions
    directions: [...new Set(all.map(t => t.direction || "(empty)"))].sort(),
  });
}

import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const { data: all, error } = await getSupabase().from("transactions").select("id, amount, category, flag, categorized_by").limit(10000);

  if (error) {
    console.error("Stats query error:", error);
    return NextResponse.json({ total_transactions: 0, total_amount: 0, categorized: 0, uncategorized: 0, suspicious_amount: 0, suspicious_breakdown: [], by_category: [], by_flag: [] });
  }
  if (!all) return NextResponse.json({ total_transactions: 0, total_amount: 0, categorized: 0, uncategorized: 0, suspicious_amount: 0, suspicious_breakdown: [], by_category: [], by_flag: [] });

  const total = all.length;
  const totalAmount = all.reduce((s, t) => s + (t.amount || 0), 0);
  const categorized = all.filter(t => t.category && t.category !== "").length;
  const uncategorized = total - categorized;

  const suspiciousItems = all.filter(t =>
    t.flag === "suspicious" || t.flag === "critical" || (t.category && t.category.startsWith("SUSPICIOUS"))
  );
  const suspiciousAmount = suspiciousItems.reduce((s, t) => s + (t.amount || 0), 0);

  // Group by category
  const byCategoryMap: Record<string, { count: number; total_amount: number }> = {};
  all.forEach(t => {
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
  all.forEach(t => {
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

  return NextResponse.json({
    total_transactions: total,
    total_amount: totalAmount,
    categorized,
    uncategorized,
    suspicious_amount: suspiciousAmount,
    suspicious_breakdown: suspiciousBreakdown,
    by_category: byCategory,
    by_flag: byFlag,
  });
}

import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const db = getSupabase();
  const { data, error } = await db
    .from("transactions")
    .select("counterparty, amount")
    .neq("counterparty", "")
    .not("counterparty", "is", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const map: Record<string, { name: string; count: number; total_amount: number }> = {};
  for (const t of data || []) {
    const cp = t.counterparty;
    if (!map[cp]) map[cp] = { name: cp, count: 0, total_amount: 0 };
    map[cp].count++;
    map[cp].total_amount += t.amount || 0;
  }

  const list = Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json(list);
}

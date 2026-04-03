import { NextResponse } from "next/server";
import { fetchAll } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const data = await fetchAll("transactions", "counterparty, amount", q => q.neq("counterparty", "").not("counterparty", "is", null));

    const map: Record<string, { name: string; count: number; total_amount: number }> = {};
    for (const t of data) {
      const cp = t.counterparty;
      if (!map[cp]) map[cp] = { name: cp, count: 0, total_amount: 0 };
      map[cp].count++;
      map[cp].total_amount += t.amount || 0;
    }

    const list = Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json(list);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { fetchAll } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const data = await fetchAll("transactions", "bank", q => q.neq("bank", "").not("bank", "is", null));
    const banks = [...new Set(data.map(t => t.bank).filter(Boolean))].sort();
    return NextResponse.json(banks);
  } catch { return NextResponse.json([]); }
}

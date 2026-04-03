import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const db = getSupabase();
  const { data, error } = await db.from("transactions").select("bank").neq("bank", "").not("bank", "is", null);
  if (error) return NextResponse.json([]);
  const banks = [...new Set((data || []).map(t => t.bank).filter(Boolean))].sort();
  return NextResponse.json(banks);
}

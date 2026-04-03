import { NextResponse } from "next/server";
import { fetchAll } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const data = await fetchAll("transactions", "account", q => q.neq("account", "").not("account", "is", null));
    const accounts = [...new Set(data.map(t => t.account).filter(Boolean))].sort();
    return NextResponse.json(accounts);
  } catch { return NextResponse.json([]); }
}

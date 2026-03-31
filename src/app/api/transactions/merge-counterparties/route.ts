import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const { names, canonical } = await req.json();

  if (!names || !Array.isArray(names) || names.length === 0 || !canonical) {
    return NextResponse.json({ error: "Provide 'names' array and 'canonical' string" }, { status: 400 });
  }

  const db = getSupabase();

  // Count how many will be updated
  const { count } = await db
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .in("counterparty", names.filter((n: string) => n !== canonical));

  // Do the update
  const { error } = await db
    .from("transactions")
    .update({ counterparty: canonical })
    .in("counterparty", names);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    message: `Merged ${names.length} names into "${canonical}" — updated ${count || 0} transactions`,
    updated: count || 0,
  });
}

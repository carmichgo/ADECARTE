import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const { ids, updates } = await req.json();

  const allowed = ["category", "subcategory", "flag", "notes"];
  const fields: Record<string, any> = {};
  for (const key of allowed) {
    if (key in updates) fields[key] = updates[key];
  }
  if ("category" in updates) fields.categorized_by = "manual";

  if (Object.keys(fields).length === 0 || !ids?.length) {
    return NextResponse.json({ error: "No valid updates or IDs" }, { status: 400 });
  }

  const { error } = await getSupabase().from("transactions").update(fields).in("id", ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ message: `Updated ${ids.length} transactions` });
}

import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const data = await req.json();
  const id = params.id;

  const allowed = ["category", "subcategory", "flag", "notes", "counterparty", "direction", "bank", "fraudulent_signature", "amount"];
  const updates: Record<string, any> = {};

  for (const key of allowed) {
    if (key in data) updates[key] = data[key];
  }
  if ("category" in data) updates.categorized_by = "manual";

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields" }, { status: 400 });
  }

  const { error } = await getSupabase().from("transactions").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ message: "Updated" });
}

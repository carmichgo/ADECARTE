import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;

  const supabase = getSupabase();
  let query = supabase.from("transactions").select("*");

  if (p.get("category")) query = query.eq("category", p.get("category")!);
  if (p.get("flag")) query = query.eq("flag", p.get("flag")!);
  if (p.get("categorized_by")) query = query.eq("categorized_by", p.get("categorized_by")!);
  if (p.get("uncategorized")) query = query.or("category.eq.,category.is.null");
  if (p.get("search")) {
    const s = `%${p.get("search")}%`;
    query = query.or(`description.ilike.${s},counterparty.ilike.${s},notes.ilike.${s},reference.ilike.${s}`);
  }
  if (p.get("min_amount")) query = query.gte("amount", parseFloat(p.get("min_amount")!));
  if (p.get("max_amount")) query = query.lte("amount", parseFloat(p.get("max_amount")!));
  if (p.get("date_from")) query = query.gte("date", p.get("date_from")!);
  if (p.get("date_to")) query = query.lte("date", p.get("date_to")!);
  if (p.get("batch")) query = query.eq("upload_batch", p.get("batch")!);

  const order = p.get("order") || "date";
  const allowed = ["date", "amount", "description", "category", "flag", "id"];
  const orderField = allowed.includes(order) ? order : "date";
  const desc = p.get("desc") === "1";

  query = query.order(orderField, { ascending: !desc });

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

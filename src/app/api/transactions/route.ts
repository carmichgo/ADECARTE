import { NextRequest, NextResponse } from "next/server";
import { getSupabase, fetchAll } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const p = req.nextUrl.searchParams;
    const order = p.get("order") || "id";
    const allowed = ["date", "amount", "description", "category", "flag", "id"];
    const orderField = allowed.includes(order) ? order : "id";
    const desc = p.get("desc") === "1";

    const data = await fetchAll("transactions", "*", (query: any) => {
      if (p.get("category")) query = query.eq("category", p.get("category")!);
      if (p.get("flag")) query = query.eq("flag", p.get("flag")!);
      if (p.get("categorized_by")) query = query.eq("categorized_by", p.get("categorized_by")!);
      if (p.get("uncategorized")) query = query.or("category.eq.,category.is.null,categorized_by.eq.,categorized_by.is.null");
      if (p.get("search")) {
        const s = `%${p.get("search")}%`;
        query = query.or(`description.ilike.${s},counterparty.ilike.${s},reference.ilike.${s},beneficiary.ilike.${s},ext_bank.ilike.${s}`);
      }
      if (p.get("min_amount")) query = query.gte("amount", parseFloat(p.get("min_amount")!));
      if (p.get("max_amount")) query = query.lte("amount", parseFloat(p.get("max_amount")!));
      if (p.get("date_from")) query = query.gte("date", p.get("date_from")!);
      if (p.get("date_to")) query = query.lte("date", p.get("date_to")!);
      if (p.get("bank")) query = query.eq("bank", p.get("bank")!);
      if (p.get("account")) query = query.eq("account", p.get("account")!);
      if (p.get("direction")) query = query.eq("direction", p.get("direction")!);
      if (p.get("counterparty")) query = query.ilike("counterparty", `%${p.get("counterparty")}%`);
      if (p.get("ext_bank")) query = query.eq("ext_bank", p.get("ext_bank")!);
      if (p.get("batch")) query = query.eq("upload_batch", p.get("batch")!);
      query = query.order(orderField, { ascending: !desc });
      return query;
    });

    return NextResponse.json(data);
  } catch (err: any) {
    console.error("Transactions route error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

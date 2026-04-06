import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const { data, error } = await getSupabase()
    .from("transactions")
    .select("*")
    .order("date");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const headers = [
    "id", "date", "settle_date", "description", "amount", "unit_price",
    "quantity", "currency", "account", "account_name", "reference",
    "counterparty", "beneficiary", "ext_bank", "symbol", "security", "strategy", "direction", "bank",
    "category", "subcategory", "flag", "notes", "categorized_by",
  ];

  const csvRows = [headers.join(",")];
  for (const r of data || []) {
    csvRows.push(headers.map(h => {
      const val = String(r[h] ?? "");
      return val.includes(",") || val.includes('"') || val.includes("\n")
        ? `"${val.replace(/"/g, '""')}"` : val;
    }).join(","));
  }

  return new NextResponse(csvRows.join("\n"), {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": "attachment; filename=transactions_export.csv",
    },
  });
}

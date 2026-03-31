import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import Papa from "papaparse";

const FIELD_PATTERNS: Record<string, string[]> = {
  date: ["date", "fecha", "transaction date", "trans date", "posting date", "value date"],
  description: ["description", "descripcion", "memo", "detail", "details", "narrative", "concept", "concepto", "transaction description"],
  amount: ["amount", "monto", "importe", "value", "sum", "debit", "credit"],
  currency: ["currency", "moneda", "ccy"],
  account: ["account", "cuenta", "account number", "acct"],
  reference: ["reference", "referencia", "ref", "transaction id", "trans id", "id"],
  counterparty: ["counterparty", "beneficiary", "beneficiario", "payee", "recipient", "destinatario", "to", "from"],
};

function autoMapFields(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const lowerMap: Record<string, string> = {};
  headers.forEach(h => { lowerMap[h.toLowerCase().trim()] = h; });

  for (const [field, candidates] of Object.entries(FIELD_PATTERNS)) {
    for (const candidate of candidates) {
      if (lowerMap[candidate]) { mapping[field] = lowerMap[candidate]; break; }
    }
  }
  if (!mapping.description && headers.length > 0) mapping.description = headers[0];
  return mapping;
}

function parseAmount(val: string): number {
  if (!val) return 0;
  const cleaned = val.replace(/[,$€\s]/g, "");
  return parseFloat(cleaned) || 0;
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File;
  const fieldMapStr = formData.get("field_map") as string;

  if (!file || !file.name.endsWith(".csv")) {
    return NextResponse.json({ error: "File must be a CSV" }, { status: 400 });
  }

  const text = await file.text();
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });

  if (!parsed.meta.fields || parsed.data.length === 0) {
    return NextResponse.json({ error: "CSV has no data" }, { status: 400 });
  }

  const fieldMap = fieldMapStr ? JSON.parse(fieldMapStr) : autoMapFields(parsed.meta.fields);
  const batchId = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15);

  const rows = parsed.data.map((row: any) => ({
    upload_batch: batchId,
    date: (row[fieldMap.date] || "").trim(),
    description: (row[fieldMap.description] || "").trim(),
    amount: parseAmount(row[fieldMap.amount] || ""),
    currency: (row[fieldMap.currency] || "").trim(),
    account: (row[fieldMap.account] || "").trim(),
    reference: (row[fieldMap.reference] || "").trim(),
    counterparty: (row[fieldMap.counterparty] || "").trim(),
    raw_data: row,
    category: "",
    subcategory: "",
    flag: "",
    notes: "",
    categorized_by: "",
  }));

  const { error } = await getSupabase().from("transactions").insert(rows);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    message: `Uploaded ${rows.length} transactions`,
    batch_id: batchId,
    fields_detected: parsed.meta.fields,
    field_map: fieldMap,
    count: rows.length,
  });
}

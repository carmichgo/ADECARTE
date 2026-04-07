import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import Papa from "papaparse";

const FIELD_PATTERNS: Record<string, string[]> = {
  date: ["date", "fecha", "transaction date", "trans date", "posting date", "value date", "trade date"],
  settle_date: ["settle date", "settlement date", "fecha liquidacion"],
  description: ["description", "descripcion", "memo", "detail", "details", "narrative", "concept", "concepto", "transaction description"],
  amount: ["amount", "monto", "importe", "value", "sum", "debit", "credit"],
  unit_price: ["unit price", "price", "precio", "unit cost"],
  quantity: ["quantity", "qty", "cantidad", "shares"],
  currency: ["currency", "moneda", "ccy"],
  account: ["account", "cuenta", "account number", "acct"],
  account_name: ["account name", "nombre cuenta"],
  reference: ["reference", "referencia", "ref", "transaction id", "trans id", "id"],
  counterparty: ["counterparty", "payee", "recipient", "destinatario", "to", "from", "receiving entity"],
  beneficiary: ["beneficiary", "beneficiario", "ultimate beneficiary", "for benefit of", "fbo"],
  symbol: ["symbol", "ticker", "simbolo"],
  security: ["security", "instrument", "titulo", "security name"],
  strategy: ["strategy", "estrategia"],
  direction: ["direction", "side", "type", "buy/sell", "direccion"],
  bank: ["bank", "custodian", "broker", "institution", "banco"],
  ext_bank: ["ext_bank", "external bank", "receiving bank", "originating bank", "dest bank"],
  category: ["category", "categoria", "classification"],
  subcategory: ["subcategory", "subcategoria", "sub category"],
  flag: ["flag", "status", "alert", "risk"],
  notes: ["notes", "note", "notas", "comments", "remarks"],
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

  const rows = parsed.data.map((row: any) => {
    const rawAmount = parseAmount(row[fieldMap.amount] || "");
    const direction = (row[fieldMap.direction] || "").trim().toLowerCase();
    // Make amount negative for withdrawals, positive for contributions
    const isWithdraw = direction.match(/^(withdraw|withdrawal|sell|out|outgoing|debit|payment|disbursement)/) && !direction.match(/internal|transfer between/);
    const isContribution = direction.match(/^(contribut|buy|in|incoming|deposit|credit|receive)/);
    const amount = isWithdraw ? -Math.abs(rawAmount) : isContribution ? Math.abs(rawAmount) : rawAmount;
    // Normalize direction
    const normalizedDirection = direction.match(/internal|transfer between/) ? "Internal Transfer" : isWithdraw ? "Withdraw" : isContribution ? "Contribution" : (row[fieldMap.direction] || "").trim();

    return {
    upload_batch: batchId,
    date: (row[fieldMap.date] || "").trim(),
    settle_date: (row[fieldMap.settle_date] || "").trim(),
    description: (row[fieldMap.description] || "").trim(),
    amount,
    unit_price: parseAmount(row[fieldMap.unit_price] || ""),
    quantity: parseAmount(row[fieldMap.quantity] || ""),
    currency: (row[fieldMap.currency] || "").trim(),
    account: (row[fieldMap.account] || "").trim(),
    account_name: (row[fieldMap.account_name] || "").trim(),
    reference: (row[fieldMap.reference] || "").trim(),
    counterparty: (row[fieldMap.counterparty] || "").trim(),
    beneficiary: (row[fieldMap.beneficiary] || "").trim(),
    symbol: (row[fieldMap.symbol] || "").trim(),
    security: (row[fieldMap.security] || "").trim(),
    strategy: (row[fieldMap.strategy] || "").trim(),
    direction: normalizedDirection,
    bank: (row[fieldMap.bank] || "").trim(),
    ext_bank: (row[fieldMap.ext_bank] || "").trim(),
    raw_data: row,
    category: (row[fieldMap.category] || "").trim(),
    subcategory: (row[fieldMap.subcategory] || "").trim(),
    flag: (row[fieldMap.flag] || "").trim(),
    notes: (row[fieldMap.notes] || "").trim(),
    categorized_by: "",
  };
  });

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

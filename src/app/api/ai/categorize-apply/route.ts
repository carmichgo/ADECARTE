import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const { proposals, action } = await req.json();
  // action: "apply" or "undo"
  const db = getSupabase();

  if (action === "undo") {
    // proposals here is the snapshot array with original values
    let restored = 0;
    for (const s of proposals) {
      await db.from("transactions").update({
        category: s.category || "",
        subcategory: s.subcategory || "",
        flag: s.flag || "",
        direction: s.direction || "",
        notes: s.notes || "",
        categorized_by: s.categorized_by || "",
      }).eq("id", s.id);
      restored++;
    }
    return NextResponse.json({ message: `Undone — restored ${restored} transactions to previous state` });
  }

  if (!proposals || !Array.isArray(proposals) || proposals.length === 0) {
    return NextResponse.json({ error: "No proposals to apply" }, { status: 400 });
  }

  // First, snapshot current state of all affected transactions for undo
  const ids = proposals.map((p: any) => p.id);
  const { data: snapshot } = await db
    .from("transactions")
    .select("id, category, subcategory, flag, direction, notes, categorized_by")
    .in("id", ids);

  // Apply the proposals
  let applied = 0;
  for (const p of proposals) {
    const update: any = {
      category: p.category || "Other",
      subcategory: p.subcategory || "",
      flag: p.flag || "review",
      notes: `[AI confidence: ${p.confidence ?? "?"}] ${p.reasoning || ""}`,
      categorized_by: "ai",
    };
    // Auto-fix direction based on category rules
    if (p.category === "LOC External Transfer") update.direction = "Withdraw";
    if (p.category === "Internal Transfer") update.direction = "Internal Transfer";
    if (p.category === "Transfers Between Accounts") update.direction = "Internal Transfer";
    if (p.category === "LOC Funded Deposit") update.direction = "Contribution";
    // Manual override from the preview UI takes priority
    if (p.direction && p.direction !== "" && p.direction !== "Keep current" && p.direction !== update.direction) update.direction = p.direction;
    if (p.counterparty) update.counterparty = p.counterparty;
    if (p.beneficiary) update.beneficiary = p.beneficiary;
    // Auto-flag known fraudulent parties as verified_fraud
    const allText = `${p.counterparty || ""} ${p.beneficiary || ""} ${update.counterparty || ""} ${update.beneficiary || ""} ${p.reasoning || ""}`.toLowerCase();
    if ((allText.includes("aira") && allText.includes("kresch")) || allText.includes("nankin") || allText.includes("la saga")) update.flag = "verified_fraud";
    await db.from("transactions").update(update).eq("id", p.id);
    applied++;
  }

  return NextResponse.json({
    message: `Applied ${applied} categorizations`,
    applied,
    snapshot: snapshot || [],
  });
}

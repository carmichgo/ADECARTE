import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 300;

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const userInstructions = body.instructions || "";
  const investigationContext = body.context || "";

  const db = getSupabase();

  const { data: manual } = await db
    .from("transactions")
    .select("description, amount, counterparty, category, subcategory, flag, notes")
    .eq("categorized_by", "manual")
    .neq("category", "");

  if (!manual || manual.length < 3) {
    return NextResponse.json({
      error: "Need at least 3 manually categorized transactions as examples.",
    }, { status: 400 });
  }

  // Get uncategorized: empty category, null category, or never categorized
  const { data: uc1 } = await db.from("transactions").select("id, description, amount, counterparty, reference, date, raw_data").eq("category", "");
  const { data: uc2 } = await db.from("transactions").select("id, description, amount, counterparty, reference, date, raw_data").is("category", null);
  const { data: uc3 } = await db.from("transactions").select("id, description, amount, counterparty, reference, date, raw_data").or("categorized_by.eq.,categorized_by.is.null");
  const ucIds = new Set<number>();
  const uncategorized: any[] = [];
  for (const list of [uc1, uc2, uc3]) {
    for (const t of list || []) { if (!ucIds.has(t.id)) { ucIds.add(t.id); uncategorized.push(t); } }
  }

  if (!uncategorized || uncategorized.length === 0) {
    return NextResponse.json({ message: "All transactions are already categorized", categorized: 0 });
  }

  const { data: categories } = await db
    .from("categories")
    .select("name, description, is_suspicious");

  const examples = manual.map(m => ({
    description: m.description,
    amount: m.amount,
    counterparty: m.counterparty,
    category: m.category,
    ...(m.flag ? { flag: m.flag } : {}),
  }));

  const categoryList = (categories || []).map(c =>
    `- ${c.name}: ${c.description}${c.is_suspicious ? " [SUSPICIOUS]" : ""}`
  ).join("\n");

  const client = new Anthropic({ apiKey });
  const batchSize = 50;
  let totalCategorized = 0;
  const allResults: any[] = [];

  for (let i = 0; i < uncategorized.length; i += batchSize) {
    const batch = uncategorized.slice(i, i + batchSize);
    const txnList = batch.map(t => ({
      id: t.id,
      description: t.description,
      amount: t.amount,
      counterparty: t.counterparty,
      reference: t.reference,
      date: t.date,
    }));

    const prompt = `You are a forensic accountant investigating potential financial fraud and unauthorized money transfers.

Your job is to categorize bank/financial transactions based on the examples provided by the investigator, and flag any suspicious activity.

## CONTEXT
We are investigating a case where money was stolen/diverted through unauthorized transactions. Pay special attention to:
- Transfers to unknown or unusual recipients
- Amounts that don't match normal business patterns
- Transactions with vague descriptions
- Round-number transfers that could indicate manual/fraudulent payments
- Duplicate or near-duplicate transactions
- Any patterns that suggest systematic diversion of funds
${investigationContext ? `\n## INVESTIGATION BACKGROUND\n${investigationContext}\n` : ""}${userInstructions ? `\n## INVESTIGATOR INSTRUCTIONS\n${userInstructions}\n` : ""}
## AVAILABLE CATEGORIES
${categoryList}

## EXAMPLES (manually categorized by the investigator)
${JSON.stringify(examples, null, 2)}

## TRANSACTIONS TO CATEGORIZE
${JSON.stringify(txnList, null, 2)}

## INSTRUCTIONS
For each transaction, respond with a JSON array where each element has:
- "id": the transaction id
- "category": one of the available categories (MUST match exactly)
- "subcategory": optional more specific label
- "flag": one of "normal", "review", "suspicious", "critical"
- "direction": MUST be one of "Contribution", "Withdraw", "Internal Transfer"
- "confidence": 0.0-1.0 how confident you are
- "reasoning": brief explanation of why this category and flag

Direction rules:
- "Contribution" = money coming IN (deposits, income, credits)
- "Withdraw" = money going OUT (payments, withdrawals, debits)
- "Internal Transfer" = money moving between the entity's OWN accounts (not real inflow/outflow)
Always set direction. If a transaction moves money between accounts owned by the same entity, it is "Internal Transfer".

Be aggressive about flagging suspicious transactions - it's better to flag something for review than to miss fraud.

Respond with ONLY the JSON array, no other text.`;

    try {
      const response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      });

      let resultText = response.content[0].type === "text" ? response.content[0].text.trim() : "";
      if (resultText.startsWith("```")) {
        resultText = resultText.split("\n").slice(1).join("\n").replace(/```\s*$/, "");
      }

      const results = JSON.parse(resultText);

      for (const r of results) {
        const update: any = {
          category: r.category || "Other",
          subcategory: r.subcategory || "",
          flag: r.flag || "review",
          notes: `[AI confidence: ${r.confidence ?? "?"}] ${r.reasoning || ""}`,
          categorized_by: "ai",
        };
        if (r.direction) update.direction = r.direction;
        await db.from("transactions").update(update).eq("id", r.id);

        totalCategorized++;
        allResults.push(r);
      }
    } catch (err) {
      console.error("AI batch error:", err);
      continue;
    }
  }

  return NextResponse.json({
    message: `AI categorized ${totalCategorized} transactions`,
    categorized: totalCategorized,
    results: allResults,
  });
}

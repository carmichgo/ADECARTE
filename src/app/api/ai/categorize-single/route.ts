import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });

  const { id, instructions: userInstructions, context: investigationContext } = await req.json();
  if (!id) return NextResponse.json({ error: "No transaction id" }, { status: 400 });

  const db = getSupabase();

  // Get the transaction
  const { data: txn } = await db.from("transactions").select("*").eq("id", id).single();
  if (!txn) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });

  // Get manual examples for context
  const { data: examples } = await db
    .from("transactions")
    .select("description, amount, counterparty, category, subcategory, flag")
    .eq("categorized_by", "manual")
    .neq("category", "")
    .limit(20);

  // Get categories
  const { data: categories } = await db.from("categories").select("name, description, is_suspicious");

  const categoryList = (categories || []).map(c =>
    `- ${c.name}: ${c.description}${c.is_suspicious ? " [SUSPICIOUS]" : ""}`
  ).join("\n");

  const exampleText = examples && examples.length > 0
    ? `\n## EXAMPLES\n${JSON.stringify(examples, null, 2)}\n` : "";

  const client = new Anthropic({ apiKey });

  const prompt = `You are a forensic accountant investigating fraud. Categorize this single transaction.

## AVAILABLE CATEGORIES
${categoryList}
${exampleText}
${investigationContext ? `## INVESTIGATION BACKGROUND\n${investigationContext}\n` : ""}${userInstructions ? `## INVESTIGATOR INSTRUCTIONS\n${userInstructions}\n` : ""}
## TRANSACTION TO CATEGORIZE
${JSON.stringify({
  date: txn.date,
  description: txn.description,
  amount: txn.amount,
  counterparty: txn.counterparty,
  symbol: txn.symbol,
  security: txn.security,
  direction: txn.direction,
  account: txn.account || txn.account_name,
  strategy: txn.strategy,
  reference: txn.reference,
}, null, 2)}

Respond with ONLY a JSON object:
{
  "category": "exact category name from the list",
  "subcategory": "optional specific label",
  "flag": "normal" | "review" | "suspicious" | "critical",
  "direction": "Contribution" | "Withdraw" | "Internal Transfer",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}

IMPORTANT for direction:
- "Contribution" = money coming IN (deposits, income, credits)
- "Withdraw" = money going OUT (payments, withdrawals, debits)
- "Internal Transfer" = money moving between the entity's OWN accounts (not real inflow/outflow)
You MUST always set direction. If a transaction moves money between accounts owned by the same entity, it is "Internal Transfer".`;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    let text = response.content[0].type === "text" ? response.content[0].text.trim() : "";
    if (text.startsWith("```")) text = text.split("\n").slice(1).join("\n").replace(/```\s*$/, "");

    const result = JSON.parse(text);

    const update: any = {
      category: result.category || "Other",
      subcategory: result.subcategory || "",
      flag: result.flag || "review",
      notes: `[AI confidence: ${result.confidence ?? "?"}] ${result.reasoning || ""}`,
      categorized_by: "ai",
    };
    if (result.direction) update.direction = result.direction;
    await db.from("transactions").update(update).eq("id", id);

    return NextResponse.json({ ...result, id });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

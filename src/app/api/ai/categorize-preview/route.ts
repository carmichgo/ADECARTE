import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });

  const { instructions, context } = await req.json().catch(() => ({}));
  const db = getSupabase();

  // Get manual examples
  const { data: manual } = await db
    .from("transactions")
    .select("description, amount, counterparty, category, subcategory, flag, direction")
    .eq("categorized_by", "manual")
    .neq("category", "")
    .limit(20);

  if (!manual || manual.length < 1) {
    return NextResponse.json({ error: "Need at least 1 manually categorized transaction as example." }, { status: 400 });
  }

  // Get uncategorized
  const { data: uncategorized } = await db
    .from("transactions")
    .select("id, description, amount, counterparty, reference, date, symbol, security, direction, account, account_name, strategy, category, flag")
    .or("category.eq.,category.is.null")
    .limit(500);

  if (!uncategorized || uncategorized.length === 0) {
    return NextResponse.json({ message: "All transactions are already categorized", preview: [] });
  }

  // Get categories
  const { data: categories } = await db.from("categories").select("name, description, is_suspicious");

  const examples = manual.map(m => ({
    description: m.description, amount: m.amount, counterparty: m.counterparty,
    category: m.category, direction: m.direction,
    ...(m.flag ? { flag: m.flag } : {}),
  }));

  const categoryList = (categories || []).map(c =>
    `- ${c.name}: ${c.description}${c.is_suspicious ? " [SUSPICIOUS]" : ""}`
  ).join("\n");

  const client = new Anthropic({ apiKey });
  const batchSize = 40;
  const allResults: any[] = [];

  for (let i = 0; i < uncategorized.length; i += batchSize) {
    const batch = uncategorized.slice(i, i + batchSize);
    const txnList = batch.map(t => ({
      id: t.id, description: t.description, amount: t.amount,
      counterparty: t.counterparty, reference: t.reference, date: t.date,
      symbol: t.symbol, security: t.security, direction: t.direction,
      account: t.account || t.account_name, strategy: t.strategy,
    }));

    const prompt = `You are a forensic accountant investigating potential financial fraud.
${context ? `\n## INVESTIGATION BACKGROUND\n${context}\n` : ""}${instructions ? `\n## INVESTIGATOR INSTRUCTIONS\n${instructions}\n` : ""}
## AVAILABLE CATEGORIES
${categoryList}

## EXAMPLES
${JSON.stringify(examples, null, 2)}

## TRANSACTIONS TO CATEGORIZE
${JSON.stringify(txnList, null, 2)}

For each transaction, respond with a JSON array where each element has:
- "id": transaction id
- "category": exact category name
- "subcategory": optional label
- "flag": "normal" | "review" | "suspicious" | "critical"
- "direction": "Contribution" | "Withdraw" | "Internal Transfer"
- "confidence": 0.0-1.0
- "reasoning": brief explanation

Direction rules: Contribution=money IN, Withdraw=money OUT, Internal Transfer=between own accounts.
Be aggressive about flagging suspicious transactions.
Respond with ONLY the JSON array.`;

    try {
      const response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      });

      let text = response.content[0].type === "text" ? response.content[0].text.trim() : "";
      if (text.startsWith("```")) text = text.split("\n").slice(1).join("\n").replace(/```\s*$/, "");
      const results = JSON.parse(text);

      // Attach original transaction data for preview
      for (const r of results) {
        const orig = batch.find(t => t.id === r.id);
        if (orig) {
          allResults.push({
            ...r,
            original: {
              description: orig.description,
              amount: orig.amount,
              date: orig.date,
              counterparty: orig.counterparty,
              direction: orig.direction,
              category: orig.category,
              flag: orig.flag,
            },
          });
        }
      }
    } catch (err) {
      console.error("Preview batch error:", err);
      continue;
    }
  }

  return NextResponse.json({
    message: `AI generated ${allResults.length} categorization proposals`,
    preview: allResults,
  });
}

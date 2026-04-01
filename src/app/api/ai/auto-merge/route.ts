import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  const { dryRun } = await req.json().catch(() => ({ dryRun: false }));

  const db = getSupabase();

  // Get all unique counterparties with counts
  const { data, error } = await db
    .from("transactions")
    .select("counterparty, amount")
    .neq("counterparty", "")
    .not("counterparty", "is", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const cpMap: Record<string, { count: number; total: number }> = {};
  for (const t of data || []) {
    const cp = t.counterparty;
    if (!cpMap[cp]) cpMap[cp] = { count: 0, total: 0 };
    cpMap[cp].count++;
    cpMap[cp].total += t.amount || 0;
  }

  const counterparties = Object.entries(cpMap)
    .map(([name, v]) => ({ name, count: v.count, total: v.total }))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (counterparties.length < 2) {
    return NextResponse.json({ message: "Not enough counterparties to merge", merges: [], applied: 0 });
  }

  const client = new Anthropic({ apiKey });

  const prompt = `You are a data deduplication expert. Below is a list of counterparty names extracted from financial transactions, with their transaction count and total amount.

Many of these are the same entity written differently (typos, abbreviations, different formats, partial names, etc.). Your job is to identify groups that should be merged into one canonical name.

## COUNTERPARTY LIST
${counterparties.map(c => `- "${c.name}" (${c.count} txns, $${c.total.toFixed(2)})`).join("\n")}

## RULES
- Group names that clearly refer to the same entity
- Pick the most complete, properly formatted name as the canonical name
- Use proper capitalization (e.g., "Wells Fargo" not "WELLS FARGO")
- Don't merge names that are genuinely different entities
- Only merge when you are confident they are the same
- Include single-entry names if they match a group
- Stock purchases like "Buy AAPL - Apple Inc" and "Buy AAPL" are the same
- Abbreviations: "JP Morgan", "JPM", "J.P. Morgan Chase" → "J.P. Morgan Chase"
- Same person different format: "SMITH JOHN", "John Smith", "J. Smith" → "John Smith"

## RESPONSE FORMAT
Respond with ONLY a JSON array of merge groups. Each element:
{
  "canonical": "The canonical name to use",
  "names": ["name1", "name2", ...],
  "reason": "Brief explanation"
}

Only include groups with 2+ names to merge. If no merges are needed, return an empty array [].
Respond with ONLY the JSON array.`;

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

    const merges = JSON.parse(resultText);

    if (!Array.isArray(merges)) {
      return NextResponse.json({ error: "AI returned invalid format", merges: [], applied: 0 });
    }

    if (dryRun) {
      return NextResponse.json({
        message: `Found ${merges.length} merge groups (dry run — not applied)`,
        merges,
        applied: 0,
      });
    }

    // Apply merges
    let totalUpdated = 0;
    for (const group of merges) {
      const { canonical, names } = group;
      if (!canonical || !names || names.length < 2) continue;

      const toMerge = names.filter((n: string) => n !== canonical);
      if (toMerge.length === 0) continue;

      const { error: updateError } = await db
        .from("transactions")
        .update({ counterparty: canonical })
        .in("counterparty", toMerge);

      if (!updateError) {
        totalUpdated += toMerge.length;
      }
    }

    return NextResponse.json({
      message: `Merged ${merges.length} groups (${totalUpdated} name variants consolidated)`,
      merges,
      applied: totalUpdated,
    });
  } catch (err: any) {
    console.error("Auto-merge error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  const { message, balanceData, transactionCounts, rawTransactions } = await req.json();

  if (!message) {
    return NextResponse.json({ error: "No message provided" }, { status: 400 });
  }

  const client = new Anthropic({ apiKey });

  // Build a summary of the data for context
  const balanceSummary = (balanceData || []).map((d: any) =>
    `${d.date}: bal=${d.balance?.toFixed(2)}, in=${d.inflow?.toFixed(2)}, out=${d.outflow?.toFixed(2)}, withdrawals=${d.withdraw_count}, withdraw_total=${d.withdraw_total?.toFixed(2)}`
  ).join("\n");

  const partySummary = (transactionCounts || []).slice(0, 30).map((p: any) =>
    `${p.party}: deposits=${p.deposits}($${p.deposit_amount?.toFixed(2)}), withdrawals=${p.withdrawals}($${p.withdrawal_amount?.toFixed(2)}), net=$${(p.deposit_amount - p.withdrawal_amount).toFixed(2)}`
  ).join("\n");

  // Send a sample of raw transactions (last 200 for context)
  const rawSample = (rawTransactions || []).slice(-200).map((t: any) =>
    `[${t.date}] ${t.direction || '?'} $${t.amount} | ${t.description || '-'} | ${t.counterparty || '-'} | ${t.account || '-'} | ${t.symbol || '-'} | cat:${t.category || '-'} flag:${t.flag || '-'}`
  ).join("\n");

  const prompt = `You are a forensic financial analyst investigating potential fraud and unauthorized money transfers. You have access to transaction data and analytics.

You MUST respond with a JSON object (and ONLY JSON, no markdown) with this structure:
{
  "text": "Your analysis text here (use markdown formatting)",
  "annotations": [
    {
      "type": "circle" | "arrow" | "highlight" | "dot",
      "chart": "balance" | "account" | "parties",
      "dateIndex": <number, index in the balance_over_time array where annotation should appear>,
      "label": "Short label for the annotation",
      "color": "#hex color",
      "description": "Longer description"
    }
  ]
}

The annotations array tells the frontend where to draw visual markers on the charts:
- "circle": draws a circle around a data point to highlight it
- "arrow": draws an arrow pointing to a data point
- "highlight": highlights a region/range on the chart
- "dot": adds a prominent dot marker

For "highlight" type, also include "dateIndexEnd" for the end of the range.

## BALANCE OVER TIME DATA
${balanceSummary || "No data available"}

## TOP COUNTERPARTIES
${partySummary || "No data available"}

## RECENT RAW TRANSACTIONS (sample)
${rawSample || "No data available"}

## USER QUESTION
${message}

Analyze the data carefully. Look for:
- Sudden balance drops or spikes
- Unusual withdrawal patterns (frequency, amounts, timing)
- Suspicious counterparties (new ones, large amounts, round numbers)
- Changes in transaction patterns over time
- Signs of systematic fund diversion

Be specific with dates, amounts, and counterparty names. Always include annotations to visually mark your findings on the charts.`;

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

    const result = JSON.parse(resultText);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("AI chat error:", err);
    return NextResponse.json({
      text: "Sorry, I encountered an error analyzing the data. Please try again.",
      annotations: [],
      error: err.message,
    });
  }
}

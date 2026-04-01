import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 300;

const tools: Anthropic.Messages.Tool[] = [
  {
    name: "categorize_transactions",
    description: "Categorize one or more transactions by their IDs. Use this when you identify transactions that should be categorized or re-categorized based on your analysis.",
    input_schema: {
      type: "object" as const,
      properties: {
        updates: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "number", description: "Transaction ID" },
              category: { type: "string", description: "Category name" },
              flag: { type: "string", enum: ["normal", "review", "suspicious", "critical"] },
              direction: { type: "string", enum: ["Contribution", "Withdraw", "Internal Transfer"], description: "Change direction if needed" },
              reasoning: { type: "string", description: "Why this categorization" },
            },
            required: ["id", "category", "flag"],
          },
        },
      },
      required: ["updates"],
    },
  },
  {
    name: "flag_transactions",
    description: "Flag specific transactions as suspicious or critical. Use when you find anomalies.",
    input_schema: {
      type: "object" as const,
      properties: {
        ids: { type: "array", items: { type: "number" }, description: "Transaction IDs to flag" },
        flag: { type: "string", enum: ["review", "suspicious", "critical"] },
        notes: { type: "string", description: "Why these are flagged" },
      },
      required: ["ids", "flag", "notes"],
    },
  },
  {
    name: "annotate_chart",
    description: "Add visual annotations to the charts (circles, dots, highlights). Always use this to visually mark your findings.",
    input_schema: {
      type: "object" as const,
      properties: {
        annotations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["circle", "arrow", "highlight", "dot"] },
              chart: { type: "string", enum: ["balance", "account", "parties"] },
              dateIndex: { type: "number", description: "Index in balance_over_time array" },
              dateIndexEnd: { type: "number", description: "End index for highlight ranges" },
              label: { type: "string" },
              color: { type: "string", description: "Hex color" },
              description: { type: "string" },
            },
            required: ["type", "chart", "dateIndex", "label"],
          },
        },
      },
      required: ["annotations"],
    },
  },
];

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  const { message, balanceData, transactionCounts, rawTransactions, instructions, context } = await req.json();

  if (!message) {
    return NextResponse.json({ error: "No message provided" }, { status: 400 });
  }

  const client = new Anthropic({ apiKey });

  const balanceSummary = (balanceData || []).map((d: any) =>
    `[idx=${balanceData.indexOf(d)}] ${d.date}: bal=${d.balance?.toFixed(2)}, in=${d.inflow?.toFixed(2)}, out=${d.outflow?.toFixed(2)}, withdrawals=${d.withdraw_count}, withdraw_total=${d.withdraw_total?.toFixed(2)}`
  ).join("\n");

  const partySummary = (transactionCounts || []).slice(0, 30).map((p: any) =>
    `${p.party}: deposits=${p.deposits}($${p.deposit_amount?.toFixed(2)}), withdrawals=${p.withdrawals}($${p.withdrawal_amount?.toFixed(2)}), net=$${(p.deposit_amount - p.withdrawal_amount).toFixed(2)}`
  ).join("\n");

  const rawSample = (rawTransactions || []).slice(-200).map((t: any) =>
    `[id=${t.id}] ${t.date} | ${t.direction || '?'} $${t.amount} | ${t.description || '-'} | ${t.counterparty || '-'} | ${t.account || '-'} | ${t.symbol || '-'} | cat:${t.category || '-'} flag:${t.flag || '-'}`
  ).join("\n");

  const systemPrompt = `You are a forensic financial analyst investigating potential fraud and unauthorized money transfers. You have access to transaction data and analytics.

You have tools to:
1. **categorize_transactions** — categorize or re-categorize specific transactions
2. **flag_transactions** — flag transactions as suspicious/critical
3. **annotate_chart** — draw visual markers on the charts (circles, dots, highlights, arrows)

ALWAYS use the annotate_chart tool to visually highlight your findings on the charts.
When you identify suspicious transactions, use flag_transactions or categorize_transactions to take action.

Use markdown in your text responses for readability.
${context ? `\n## INVESTIGATION BACKGROUND\n${context}\n` : ""}${instructions ? `\n## INVESTIGATOR INSTRUCTIONS\n${instructions}\n` : ""}
## BALANCE OVER TIME DATA (dateIndex values in brackets)
${balanceSummary || "No data"}

## TOP COUNTERPARTIES
${partySummary || "No data"}

## RAW TRANSACTIONS (id values in brackets)
${rawSample || "No data"}`;

  try {
    const messages: Anthropic.Messages.MessageParam[] = [
      { role: "user", content: message },
    ];

    let allAnnotations: any[] = [];
    let categorized: any[] = [];
    let flagged: any[] = [];
    let finalText = "";

    // Run tool-use loop
    let response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: systemPrompt,
      tools,
      messages,
    });

    while (true) {
      // Collect text and tool use blocks
      for (const block of response.content) {
        if (block.type === "text") {
          finalText += block.text;
        } else if (block.type === "tool_use") {
          const input = block.input as any;

          if (block.name === "annotate_chart" && input.annotations) {
            allAnnotations.push(...input.annotations);
          }

          if (block.name === "categorize_transactions" && input.updates) {
            const db = getSupabase();
            for (const u of input.updates) {
              const upd: any = {
                category: u.category,
                flag: u.flag,
                notes: `[AI Analyst] ${u.reasoning || ""}`,
                categorized_by: "ai",
              };
              if (u.direction) upd.direction = u.direction;
              await db.from("transactions").update(upd).eq("id", u.id);
              categorized.push(u);
            }
          }

          if (block.name === "flag_transactions" && input.ids) {
            const db = getSupabase();
            await db.from("transactions").update({
              flag: input.flag,
              notes: `[AI Analyst] ${input.notes}`,
            }).in("id", input.ids);
            flagged.push({ ids: input.ids, flag: input.flag, notes: input.notes });
          }
        }
      }

      // If the model wants to continue after tool use
      if (response.stop_reason === "tool_use") {
        // Build tool results
        const toolResults: Anthropic.Messages.ToolResultBlockParam[] = response.content
          .filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use")
          .map(b => ({
            type: "tool_result" as const,
            tool_use_id: b.id,
            content: JSON.stringify({ success: true }),
          }));

        messages.push({ role: "assistant", content: response.content });
        messages.push({ role: "user", content: toolResults });

        response = await client.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
          system: systemPrompt,
          tools,
          messages,
        });
      } else {
        break;
      }
    }

    return NextResponse.json({
      text: finalText,
      annotations: allAnnotations,
      categorized,
      flagged,
    });
  } catch (err: any) {
    console.error("AI chat error:", err);
    return NextResponse.json({
      text: "Error analyzing data: " + err.message,
      annotations: [],
    });
  }
}

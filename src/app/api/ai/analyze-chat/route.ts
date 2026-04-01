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
  {
    name: "query_transactions",
    description: "Query the transactions database to get accurate data. Use this to verify numbers, find specific transactions, check peaks/drops, or answer questions needing precise data. Returns up to 100 matching rows.",
    input_schema: {
      type: "object" as const,
      properties: {
        select: { type: "string", description: "Comma-separated columns to return. E.g. 'id,date,amount,description,counterparty,flag'" },
        filters: {
          type: "array",
          description: "Array of filters to apply",
          items: {
            type: "object",
            properties: {
              column: { type: "string" },
              operator: { type: "string", enum: ["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "in", "is"] },
              value: { type: "string", description: "Value to compare. For 'in' use comma-separated. For 'is' use 'null'." },
            },
            required: ["column", "operator", "value"],
          },
        },
        order: { type: "string", description: "Column to order by" },
        ascending: { type: "boolean", description: "Sort ascending (default false)" },
        limit: { type: "number", description: "Max rows to return (default 50, max 100)" },
        explanation: { type: "string", description: "Why you need this query" },
      },
      required: ["select"],
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
1. **query_transactions** — Query the database directly for accurate data. USE THIS to verify numbers, find peaks, check specific dates/amounts, or when the summary data might be incomplete. Always query before making claims about specific values.
2. **categorize_transactions** — categorize or re-categorize specific transactions
3. **flag_transactions** — flag transactions as suspicious/critical
4. **annotate_chart** — draw visual markers on the charts (circles, dots, highlights, arrows)

IMPORTANT: ALWAYS use query_transactions first to verify your analysis before making claims. The summary data may be incomplete. Use annotate_chart to visually highlight your findings.
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
        // Build tool results — for SQL queries, return actual data
        const toolResultsPromises = response.content
          .filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use")
          .map(async (b) => {
            const inp = b.input as any;
            if (b.name === "query_transactions") {
              try {
                const db = getSupabase();
                let query: any = db.from("transactions").select(inp.select || "*");
                for (const f of (inp.filters || [])) {
                  const val = f.value;
                  if (f.operator === "eq") query = query.eq(f.column, val);
                  else if (f.operator === "neq") query = query.neq(f.column, val);
                  else if (f.operator === "gt") query = query.gt(f.column, val);
                  else if (f.operator === "gte") query = query.gte(f.column, val);
                  else if (f.operator === "lt") query = query.lt(f.column, val);
                  else if (f.operator === "lte") query = query.lte(f.column, val);
                  else if (f.operator === "like") query = query.like(f.column, val);
                  else if (f.operator === "ilike") query = query.ilike(f.column, val);
                  else if (f.operator === "in") query = query.in(f.column, val.split(",").map((v: string) => v.trim()));
                  else if (f.operator === "is") query = query.is(f.column, val === "null" ? null : val);
                }
                if (inp.order) query = query.order(inp.order, { ascending: inp.ascending ?? false });
                query = query.limit(Math.min(inp.limit || 50, 100));
                const { data, error } = await query;
                if (error) return { type: "tool_result" as const, tool_use_id: b.id, content: JSON.stringify({ error: error.message }) };
                return { type: "tool_result" as const, tool_use_id: b.id, content: JSON.stringify({ rows: data, count: data?.length || 0 }) };
              } catch (err: any) {
                return { type: "tool_result" as const, tool_use_id: b.id, content: JSON.stringify({ error: err.message }) };
              }
            }
            return { type: "tool_result" as const, tool_use_id: b.id, content: JSON.stringify({ success: true }) };
          });
        const toolResults = await Promise.all(toolResultsPromises);

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

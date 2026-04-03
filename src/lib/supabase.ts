import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Supabase credentials not configured");
    _client = createClient(url, key);
  }
  return _client;
}

// Fetch all rows from a table, paginating through Supabase's 1000-row limit
export async function fetchAll(table: string, select: string, filters?: (query: any) => any): Promise<any[]> {
  const db = getSupabase();
  const pageSize = 1000;
  let allRows: any[] = [];
  let offset = 0;

  while (true) {
    let query = db.from(table).select(select).range(offset, offset + pageSize - 1);
    if (filters) query = filters(query);
    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) break;
    allRows = allRows.concat(data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return allRows;
}

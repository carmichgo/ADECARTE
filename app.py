import os
import json
import sqlite3
import csv
import io
from datetime import datetime
from flask import Flask, request, jsonify, render_template, g
from dotenv import load_dotenv
import anthropic

load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "dev-secret-key")

DATABASE = "transactions.db"
UPLOAD_FOLDER = "uploads"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)


# ── Database ──────────────────────────────────────────────────────────────────

def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(exception):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(DATABASE)
    db.execute("""
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            upload_batch TEXT,
            date TEXT,
            description TEXT,
            amount REAL,
            currency TEXT DEFAULT '',
            account TEXT DEFAULT '',
            reference TEXT DEFAULT '',
            counterparty TEXT DEFAULT '',
            raw_data TEXT,
            category TEXT DEFAULT '',
            subcategory TEXT DEFAULT '',
            flag TEXT DEFAULT '',
            notes TEXT DEFAULT '',
            categorized_by TEXT DEFAULT '',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    db.execute("""
        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE,
            description TEXT DEFAULT '',
            is_suspicious INTEGER DEFAULT 0
        )
    """)
    # Seed default categories
    default_categories = [
        ("Salaries & Payroll", "Regular employee compensation", 0),
        ("Vendor Payments", "Payments to suppliers and vendors", 0),
        ("Utilities", "Electricity, water, internet, phone", 0),
        ("Rent & Lease", "Office or property rental payments", 0),
        ("Professional Services", "Legal, accounting, consulting fees", 0),
        ("Travel & Entertainment", "Business travel and entertainment", 0),
        ("Office Supplies", "Stationery, equipment, supplies", 0),
        ("Insurance", "Business insurance premiums", 0),
        ("Taxes & Government", "Tax payments, government fees", 0),
        ("Loan & Interest", "Loan repayments, interest charges", 0),
        ("Transfers Between Accounts", "Internal transfers", 0),
        ("Revenue / Income", "Incoming revenue or payments received", 0),
        ("Refunds & Returns", "Returned payments or refunds", 0),
        ("SUSPICIOUS - Unauthorized Transfer", "Transfers not matching authorized patterns", 1),
        ("SUSPICIOUS - Unknown Recipient", "Payments to unrecognized parties", 1),
        ("SUSPICIOUS - Unusual Amount", "Amounts outside normal ranges", 1),
        ("SUSPICIOUS - Duplicate Payment", "Possible duplicate or repeated payments", 1),
        ("SUSPICIOUS - Off-Hours Transaction", "Transactions at unusual times", 1),
        ("SUSPICIOUS - Round Number", "Suspiciously round amounts", 1),
        ("Other", "Uncategorized transactions", 0),
    ]
    for name, desc, suspicious in default_categories:
        db.execute(
            "INSERT OR IGNORE INTO categories (name, description, is_suspicious) VALUES (?, ?, ?)",
            (name, desc, suspicious),
        )
    db.commit()
    db.close()


init_db()


# ── Routes: Pages ─────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


# ── Routes: API ───────────────────────────────────────────────────────────────

@app.route("/api/upload", methods=["POST"])
def upload_csv():
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    if not file.filename.endswith(".csv"):
        return jsonify({"error": "File must be a CSV"}), 400

    content = file.read().decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(content))

    if not reader.fieldnames:
        return jsonify({"error": "CSV has no headers"}), 400

    # Map columns – try common names
    field_map = request.form.get("field_map")
    if field_map:
        field_map = json.loads(field_map)
    else:
        field_map = _auto_map_fields(reader.fieldnames)

    batch_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    db = get_db()
    count = 0

    for row in reader:
        db.execute(
            """INSERT INTO transactions
               (upload_batch, date, description, amount, currency, account,
                reference, counterparty, raw_data)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                batch_id,
                _get_mapped(row, field_map, "date"),
                _get_mapped(row, field_map, "description"),
                _parse_amount(_get_mapped(row, field_map, "amount")),
                _get_mapped(row, field_map, "currency"),
                _get_mapped(row, field_map, "account"),
                _get_mapped(row, field_map, "reference"),
                _get_mapped(row, field_map, "counterparty"),
                json.dumps(row),
            ),
        )
        count += 1

    db.commit()
    return jsonify({
        "message": f"Uploaded {count} transactions",
        "batch_id": batch_id,
        "fields_detected": reader.fieldnames,
        "field_map": field_map,
        "count": count,
    })


@app.route("/api/transactions")
def get_transactions():
    db = get_db()
    filters = []
    params = []

    if request.args.get("category"):
        filters.append("category = ?")
        params.append(request.args["category"])
    if request.args.get("flag"):
        filters.append("flag = ?")
        params.append(request.args["flag"])
    if request.args.get("categorized_by"):
        filters.append("categorized_by = ?")
        params.append(request.args["categorized_by"])
    if request.args.get("uncategorized"):
        filters.append("(category = '' OR category IS NULL)")
    if request.args.get("search"):
        filters.append("(description LIKE ? OR counterparty LIKE ? OR notes LIKE ? OR reference LIKE ?)")
        s = f"%{request.args['search']}%"
        params.extend([s, s, s, s])
    if request.args.get("min_amount"):
        filters.append("amount >= ?")
        params.append(float(request.args["min_amount"]))
    if request.args.get("max_amount"):
        filters.append("amount <= ?")
        params.append(float(request.args["max_amount"]))
    if request.args.get("date_from"):
        filters.append("date >= ?")
        params.append(request.args["date_from"])
    if request.args.get("date_to"):
        filters.append("date <= ?")
        params.append(request.args["date_to"])
    if request.args.get("batch"):
        filters.append("upload_batch = ?")
        params.append(request.args["batch"])

    where = " AND ".join(filters) if filters else "1=1"
    order = request.args.get("order", "date")
    direction = "DESC" if request.args.get("desc") else "ASC"

    allowed_orders = {"date", "amount", "description", "category", "flag", "id"}
    if order not in allowed_orders:
        order = "date"

    rows = db.execute(
        f"SELECT * FROM transactions WHERE {where} ORDER BY {order} {direction}",
        params,
    ).fetchall()

    return jsonify([dict(r) for r in rows])


@app.route("/api/transactions/<int:txn_id>", methods=["PATCH"])
def update_transaction(txn_id):
    data = request.json
    db = get_db()

    allowed = {"category", "subcategory", "flag", "notes", "counterparty"}
    updates = []
    params = []
    for key in allowed:
        if key in data:
            updates.append(f"{key} = ?")
            params.append(data[key])

    if "category" in data:
        updates.append("categorized_by = 'manual'")

    if not updates:
        return jsonify({"error": "No valid fields to update"}), 400

    params.append(txn_id)
    db.execute(
        f"UPDATE transactions SET {', '.join(updates)} WHERE id = ?", params
    )
    db.commit()
    return jsonify({"message": "Updated"})


@app.route("/api/transactions/bulk-update", methods=["POST"])
def bulk_update():
    data = request.json
    ids = data.get("ids", [])
    updates = data.get("updates", {})
    db = get_db()

    allowed = {"category", "subcategory", "flag", "notes"}
    set_clauses = []
    params = []
    for key in allowed:
        if key in updates:
            set_clauses.append(f"{key} = ?")
            params.append(updates[key])

    if "category" in updates:
        set_clauses.append("categorized_by = 'manual'")

    if not set_clauses or not ids:
        return jsonify({"error": "No valid updates or IDs"}), 400

    placeholders = ",".join("?" * len(ids))
    params.extend(ids)
    db.execute(
        f"UPDATE transactions SET {', '.join(set_clauses)} WHERE id IN ({placeholders})",
        params,
    )
    db.commit()
    return jsonify({"message": f"Updated {len(ids)} transactions"})


@app.route("/api/categories")
def get_categories():
    db = get_db()
    rows = db.execute("SELECT * FROM categories ORDER BY is_suspicious, name").fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/categories", methods=["POST"])
def add_category():
    data = request.json
    db = get_db()
    try:
        db.execute(
            "INSERT INTO categories (name, description, is_suspicious) VALUES (?, ?, ?)",
            (data["name"], data.get("description", ""), data.get("is_suspicious", 0)),
        )
        db.commit()
        return jsonify({"message": "Category added"})
    except sqlite3.IntegrityError:
        return jsonify({"error": "Category already exists"}), 409


@app.route("/api/ai/categorize", methods=["POST"])
def ai_categorize():
    """Use manually categorized transactions as examples to categorize the rest."""
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        return jsonify({"error": "ANTHROPIC_API_KEY not configured. Set it in .env file."}), 500

    db = get_db()

    # Get manually categorized transactions as training examples
    manual = db.execute(
        "SELECT description, amount, counterparty, category, subcategory, flag, notes FROM transactions WHERE categorized_by = 'manual' AND category != ''"
    ).fetchall()

    if len(manual) < 3:
        return jsonify({
            "error": "Need at least 3 manually categorized transactions as examples. Please categorize some transactions first."
        }), 400

    # Get uncategorized transactions
    uncategorized = db.execute(
        "SELECT id, description, amount, counterparty, reference, date, raw_data FROM transactions WHERE category = '' OR category IS NULL"
    ).fetchall()

    if not uncategorized:
        return jsonify({"message": "All transactions are already categorized", "categorized": 0})

    # Get available categories
    categories = db.execute("SELECT name, description, is_suspicious FROM categories").fetchall()

    # Build examples
    examples = []
    for m in manual:
        example = {
            "description": m["description"],
            "amount": m["amount"],
            "counterparty": m["counterparty"],
            "category": m["category"],
        }
        if m["flag"]:
            example["flag"] = m["flag"]
        examples.append(example)

    category_list = []
    for c in categories:
        entry = f"- {c['name']}: {c['description']}"
        if c["is_suspicious"]:
            entry += " [SUSPICIOUS]"
        category_list.append(entry)

    # Process in batches of 50
    batch_size = 50
    total_categorized = 0
    all_results = []

    client = anthropic.Anthropic(api_key=api_key)

    for i in range(0, len(uncategorized), batch_size):
        batch = uncategorized[i : i + batch_size]
        txn_list = []
        for t in batch:
            txn_list.append({
                "id": t["id"],
                "description": t["description"],
                "amount": t["amount"],
                "counterparty": t["counterparty"],
                "reference": t["reference"],
                "date": t["date"],
            })

        prompt = f"""You are a forensic accountant investigating potential financial fraud and unauthorized money transfers.

Your job is to categorize bank/financial transactions based on the examples provided by the investigator, and flag any suspicious activity.

## CONTEXT
We are investigating a case where money was stolen/diverted through unauthorized transactions. Pay special attention to:
- Transfers to unknown or unusual recipients
- Amounts that don't match normal business patterns
- Transactions with vague descriptions
- Round-number transfers that could indicate manual/fraudulent payments
- Duplicate or near-duplicate transactions
- Any patterns that suggest systematic diversion of funds

## AVAILABLE CATEGORIES
{chr(10).join(category_list)}

## EXAMPLES (manually categorized by the investigator)
{json.dumps(examples, indent=2)}

## TRANSACTIONS TO CATEGORIZE
{json.dumps(txn_list, indent=2)}

## INSTRUCTIONS
For each transaction, respond with a JSON array where each element has:
- "id": the transaction id
- "category": one of the available categories (MUST match exactly)
- "subcategory": optional more specific label
- "flag": one of "normal", "review", "suspicious", "critical"
- "confidence": 0.0-1.0 how confident you are
- "reasoning": brief explanation of why this category and flag

Be aggressive about flagging suspicious transactions - it's better to flag something for review than to miss fraud.

Respond with ONLY the JSON array, no other text."""

        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            messages=[{"role": "user", "content": prompt}],
        )

        try:
            result_text = response.content[0].text.strip()
            if result_text.startswith("```"):
                result_text = result_text.split("\n", 1)[1].rsplit("```", 1)[0]
            results = json.loads(result_text)
        except (json.JSONDecodeError, IndexError):
            continue

        for r in results:
            db.execute(
                """UPDATE transactions
                   SET category = ?, subcategory = ?, flag = ?, notes = ?, categorized_by = 'ai'
                   WHERE id = ?""",
                (
                    r.get("category", "Other"),
                    r.get("subcategory", ""),
                    r.get("flag", "review"),
                    f"[AI confidence: {r.get('confidence', '?')}] {r.get('reasoning', '')}",
                    r["id"],
                ),
            )
            total_categorized += 1
            all_results.append(r)

        db.commit()

    return jsonify({
        "message": f"AI categorized {total_categorized} transactions",
        "categorized": total_categorized,
        "results": all_results,
    })


@app.route("/api/stats")
def get_stats():
    db = get_db()

    total = db.execute("SELECT COUNT(*) as c, SUM(amount) as s FROM transactions").fetchone()
    categorized = db.execute(
        "SELECT COUNT(*) as c FROM transactions WHERE category != '' AND category IS NOT NULL"
    ).fetchone()
    uncategorized = db.execute(
        "SELECT COUNT(*) as c FROM transactions WHERE category = '' OR category IS NULL"
    ).fetchone()

    # Suspicious breakdown
    suspicious = db.execute("""
        SELECT category, flag, COUNT(*) as count, SUM(amount) as total_amount
        FROM transactions
        WHERE flag IN ('suspicious', 'critical') OR category LIKE 'SUSPICIOUS%'
        GROUP BY category, flag
        ORDER BY total_amount DESC
    """).fetchall()

    # By category
    by_category = db.execute("""
        SELECT category, COUNT(*) as count, SUM(amount) as total_amount,
               AVG(amount) as avg_amount, MIN(amount) as min_amount, MAX(amount) as max_amount
        FROM transactions
        WHERE category != '' AND category IS NOT NULL
        GROUP BY category
        ORDER BY total_amount DESC
    """).fetchall()

    # By flag
    by_flag = db.execute("""
        SELECT flag, COUNT(*) as count, SUM(amount) as total_amount
        FROM transactions
        WHERE flag != '' AND flag IS NOT NULL
        GROUP BY flag
    """).fetchall()

    # Flagged transactions total
    flagged_total = db.execute("""
        SELECT SUM(amount) as total
        FROM transactions
        WHERE flag IN ('suspicious', 'critical') OR category LIKE 'SUSPICIOUS%'
    """).fetchone()

    return jsonify({
        "total_transactions": total["c"],
        "total_amount": total["s"] or 0,
        "categorized": categorized["c"],
        "uncategorized": uncategorized["c"],
        "suspicious_amount": flagged_total["total"] or 0,
        "suspicious_breakdown": [dict(r) for r in suspicious],
        "by_category": [dict(r) for r in by_category],
        "by_flag": [dict(r) for r in by_flag],
    })


@app.route("/api/export")
def export_csv():
    db = get_db()
    rows = db.execute("SELECT * FROM transactions ORDER BY date").fetchall()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "id", "date", "description", "amount", "currency", "account",
        "reference", "counterparty", "category", "subcategory", "flag",
        "notes", "categorized_by",
    ])
    for r in rows:
        writer.writerow([
            r["id"], r["date"], r["description"], r["amount"], r["currency"],
            r["account"], r["reference"], r["counterparty"], r["category"],
            r["subcategory"], r["flag"], r["notes"], r["categorized_by"],
        ])

    from flask import Response
    return Response(
        output.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=transactions_export.csv"},
    )


@app.route("/api/reset", methods=["POST"])
def reset_db():
    db = get_db()
    db.execute("DELETE FROM transactions")
    db.commit()
    return jsonify({"message": "All transactions deleted"})


# ── Helpers ───────────────────────────────────────────────────────────────────

def _auto_map_fields(fieldnames):
    """Try to auto-detect which CSV columns map to our fields."""
    mapping = {}
    lower_fields = {f.lower().strip(): f for f in fieldnames}

    patterns = {
        "date": ["date", "fecha", "transaction date", "trans date", "posting date", "value date"],
        "description": ["description", "descripcion", "memo", "detail", "details", "narrative", "concept", "concepto", "transaction description"],
        "amount": ["amount", "monto", "importe", "value", "sum", "debit", "credit"],
        "currency": ["currency", "moneda", "ccy"],
        "account": ["account", "cuenta", "account number", "acct"],
        "reference": ["reference", "referencia", "ref", "transaction id", "trans id", "id"],
        "counterparty": ["counterparty", "beneficiary", "beneficiario", "payee", "recipient", "destinatario", "to", "from"],
    }

    for our_field, candidates in patterns.items():
        for candidate in candidates:
            if candidate in lower_fields:
                mapping[our_field] = lower_fields[candidate]
                break

    # If no description found, use the first text-like column
    if "description" not in mapping and fieldnames:
        mapping.setdefault("description", fieldnames[0])

    return mapping


def _get_mapped(row, field_map, field_name):
    csv_col = field_map.get(field_name, "")
    if csv_col and csv_col in row:
        return row[csv_col].strip()
    return ""


def _parse_amount(val):
    if not val:
        return 0.0
    val = val.replace(",", "").replace("$", "").replace("€", "").replace(" ", "")
    try:
        return float(val)
    except ValueError:
        return 0.0


if __name__ == "__main__":
    app.run(debug=True, port=5000)

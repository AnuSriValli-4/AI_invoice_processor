import os
import pytesseract
from PIL import Image
import io
from fastapi import FastAPI, UploadFile, File
from supabase import create_client, Client
from groq import Groq
import json
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
GROQ_API_KEY = os.environ.get("GROQ_API_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
groq_client = Groq(api_key=GROQ_API_KEY)

def parse_date(date_str):
    """Try multiple date formats and return ISO format or None."""
    if not date_str or date_str in ("Unknown", "N/A", ""):
        return None
    formats = ["%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y", "%B %d, %Y", "%b %d, %Y", "%d-%m-%Y", "%m-%d-%Y"]
    for fmt in formats:
        try:
            return datetime.strptime(str(date_str).strip(), fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None  # Return None if no format matches — avoids Supabase DATE rejection

def parse_float(value):
    """Safely parse a float, stripping currency symbols."""
    if value is None or value == "" or value == "N/A":
        return None
    try:
        return float(str(value).replace("$", "").replace(",", "").strip())
    except (ValueError, TypeError):
        return None

@app.get("/")
def home():
    return {"message": "Server is running!"}

@app.post("/upload")
async def process_document(file: UploadFile = File(...)):
    contents = await file.read()
    image = Image.open(io.BytesIO(contents))
    raw_text = pytesseract.image_to_string(image)

    # Expanded prompt asking for all fields your DB supports
    prompt = f"""Extract invoice data from the text below and return a JSON object with exactly these keys:
- invoice_number (string)
- vendor_name (string)
- invoice_date (string, in YYYY-MM-DD format if possible)
- pre_tax_amount (number, subtotal before tax)
- tax_amount (number, tax amount only)
- total_amount (number, final total including tax)
- payment_status (string, e.g. Paid, Unpaid, Due, Overdue — infer if not explicit)

Return only the JSON object, no explanation.

Invoice Text:
{raw_text}"""

    chat_completion = groq_client.chat.completions.create(
        messages=[{"role": "user", "content": prompt}],
        model="llama-3.3-70b-versatile",
        response_format={"type": "json_object"}
    )

    structured_data = json.loads(chat_completion.choices[0].message.content)

    parsed_date = parse_date(structured_data.get("invoice_date"))
    pre_tax = parse_float(structured_data.get("pre_tax_amount"))
    tax = parse_float(structured_data.get("tax_amount"))
    total = parse_float(structured_data.get("total_amount"))

    # If total is missing but we have components, calculate it
    if total is None and pre_tax is not None and tax is not None:
        total = round(pre_tax + tax, 2)

    data_to_save = {
        "invoice_number": str(structured_data.get("invoice_number", "N/A")),
        "vendor_name": structured_data.get("vendor_name", "Unknown"),
        "invoice_date": parsed_date,          # None-safe, won't break DATE column
        "amount": pre_tax,                    # pre-tax subtotal -> amount column
        "tax_amount": tax,
        "total_amount": total,
        "payment_status": structured_data.get("payment_status", "Unknown"),
        "source_file": file.filename
    }

    supabase.table("invoices").insert(data_to_save).execute()

    return {"status": "Success", "data": {**data_to_save, "status": "Processed"}}

@app.get("/invoices")
async def get_invoices():
    response = supabase.table("invoices").select("*").order("upload_timestamp", desc=True).execute()
    return response.data

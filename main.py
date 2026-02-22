import os
import easyocr
from fastapi import FastAPI, UploadFile, File
from supabase import create_client, Client
from groq import Groq
import json
from fastapi.middleware.cors import CORSMiddleware

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

# Initialize tools
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
groq_client = Groq(api_key=GROQ_API_KEY)
reader = easyocr.Reader(['en'])

@app.get("/")
def home():
    return {"message": "Server is running!"}

@app.post("/upload")
async def process_document(file: UploadFile = File(...)):
    # 1. Read the file
    contents = await file.read()
    
    # 2. Extract text (OCR) [cite: 46, 171]
    result = reader.readtext(contents, detail=0)
    raw_text = " ".join(result)
    
    # 3. AI Structuring (LLM) [cite: 48, 172-177]
    prompt = f"Extract data from this text into JSON with keys: invoice_number, vendor_name, amount, invoice_date. Text: {raw_text}"
    
    chat_completion = groq_client.chat.completions.create(
        messages=[{"role": "user", "content": prompt}],
        model="llama-3.3-70b-versatile",
        response_format={"type": "json_object"} 
    )
    
    structured_data = json.loads(chat_completion.choices[0].message.content)

    # 4. Save to Database [cite: 50, 186]
    # We map 'amount' from AI to 'total_amount' in your DB [cite: 106]
    data_to_save = {
        "invoice_number": str(structured_data.get("invoice_number", "N/A")),
        "vendor_name": structured_data.get("vendor_name", "Unknown"),
        "total_amount": float(structured_data.get("amount", 0)),
        "source_file": file.filename
    }
    
    supabase.table("invoices").insert(data_to_save).execute()
    
    return {"status": "Success", "data": data_to_save}

@app.get("/invoices")
async def get_invoices():
    try:
        # Pulls all records from your Supabase table
        response = supabase.table("invoices").select("*").execute()
        return response.data
    except Exception as e:
        print(f"Error fetching from Supabase: {e}")
        return []
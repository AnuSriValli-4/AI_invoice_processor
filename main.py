import os
import pytesseract
from PIL import Image
import io
from fastapi import FastAPI, UploadFile, File
from supabase import create_client, Client
from groq import Groq
import json
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# Enable CORS so your Vercel frontend can talk to this Render backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Secrets retrieved from Render Environment Variables
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
GROQ_API_KEY = os.environ.get("GROQ_API_KEY")

# Initialize tools
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
groq_client = Groq(api_key=GROQ_API_KEY)

@app.get("/")
def home():
    return {"message": "Server is running!"}

@app.post("/upload")
async def process_document(file: UploadFile = File(...)):
    # 1. Read the file into memory
    contents = await file.read()
    image = Image.open(io.BytesIO(contents))
    
    # 2. Extract text (OCR) using the lighter Tesseract library
    raw_text = pytesseract.image_to_string(image)
    
    # 3. AI Structuring (LLM) via Groq
    prompt = f"Extract data from this text into JSON with keys: invoice_number, vendor_name, amount, invoice_date. Text: {raw_text}"
    
    chat_completion = groq_client.chat.completions.create(
        messages=[{"role": "user", "content": prompt}],
        model="llama-3.3-70b-versatile",
        response_format={"type": "json_object"} 
    )
    
    structured_data = json.loads(chat_completion.choices[0].message.content)

    # 4. Save to Supabase Database
    data_to_save = {
        "invoice_number": str(structured_data.get("invoice_number", "N/A")),
        "vendor_name": structured_data.get("vendor_name", "Unknown"),
        "total_amount": float(structured_data.get("amount", 0)),
        "invoice_date": structured_data.get("invoice_date", "Unknown"),
        "source_file": file.filename
    }
    
    supabase.table("invoices").insert(data_to_save).execute()
    
    return {"status": "Success", "data": data_to_save}

@app.get("/invoices")
async def get_invoices():
    response = supabase.table("invoices").select("*").execute()
    return response.data
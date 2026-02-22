import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { CheckCircle, Loader2, Download, UploadCloud } from 'lucide-react';
import * as XLSX from 'xlsx';

const BACKEND_URL = "https://ai-invoice-processor-backend.onrender.com";

function App() {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState([]);
  const [showSuccess, setShowSuccess] = useState(false);
  const [currentProgress, setCurrentProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const loadInvoices = async () => {
      try {
        const response = await axios.get(`${BACKEND_URL}/invoices`);
        setData(response.data); 
      } catch (error) {
        console.error("History fetch failed:", error);
      }
    };
    loadInvoices();
  }, []);

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    setFiles(prev => [...prev, ...droppedFiles]);
  };

  const handleUpload = async () => {
    if (files.length === 0) return alert("Please select or drop files first!");
    setLoading(true);
    setCurrentProgress(0);

    for (let i = 0; i < files.length; i++) {
      const formData = new FormData();
      formData.append('file', files[i]);
      try {
        const response = await axios.post(`${BACKEND_URL}/upload`, formData);
        setData(prev => [response.data.data, ...prev]);
        setCurrentProgress(i + 1);
      } catch (error) {
        console.error(`Error with file ${i + 1}:`, error);
      }
    }

    setLoading(false);
    setShowSuccess(true); 
    setFiles([]); 
    setTimeout(() => setShowSuccess(false), 5000); 
  };

  const exportToExcel = () => {
    if (data.length === 0) return alert("No data to export!");
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Invoices");
    XLSX.writeFile(workbook, "Invoices_Consolidated.xlsx");
  };

  return (
    <div style={{ width: '100vw', minHeight: '100vh', fontFamily: 'sans-serif', backgroundColor: '#f4f7f6', display: 'flex', flexDirection: 'column' }}>
      <header style={{ width: '100%', padding: '60px 0', textAlign: 'center', backgroundColor: '#fff', borderBottom: '1px solid #e2e8f0', marginBottom: '50px' }}>
        <h1 style={{ color: '#1e293b', fontSize: '3rem', margin: '0 0 10px 0' }}>AI Invoice Processor</h1>
        <p style={{ color: '#64748b', fontSize: '1.2rem' }}>Bulk process documents directly to Supabase</p>
      </header>
      
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: '0 20px' }}>
        <div style={{ width: '100%', maxWidth: '700px' }}>
          
          <div style={{ backgroundColor: 'white', padding: '40px', borderRadius: '16px', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)', textAlign: 'center' }}>
            
            <div 
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              style={{ 
                border: isDragging ? '2px solid #4f46e5' : '2px dashed #cbd5e1', 
                padding: '60px 20px', 
                borderRadius: '12px', 
                marginBottom: '25px',
                backgroundColor: isDragging ? '#eef2ff' : '#f8fafc',
                transition: 'all 0.2s ease',
                cursor: 'pointer',
                position: 'relative'
              }}
            >
              <UploadCloud size={48} color={isDragging ? '#4f46e5' : '#94a3b8'} style={{ marginBottom: '15px' }} />
              <h3 style={{ color: '#334155', margin: '0 0 10px 0' }}>
                {isDragging ? "Drop them now!" : "Drag & Drop Invoices Here"}
              </h3>
              <p style={{ color: '#64748b', fontSize: '0.9rem' }}>or click to browse from your computer</p>
              
              <input 
                type="file" 
                multiple 
                onChange={(e) => setFiles(Array.from(e.target.files))} 
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }} 
              />
            </div>

            {files.length > 0 && (
              <div style={{ textAlign: 'left', marginBottom: '20px', padding: '10px', backgroundColor: '#f1f5f9', borderRadius: '8px' }}>
                <p style={{ fontSize: '0.85rem', fontWeight: 'bold', color: '#475569' }}>Selected Files ({files.length}):</p>
                <ul style={{ fontSize: '0.8rem', color: '#64748b', paddingLeft: '20px', maxHeight: '100px', overflowY: 'auto' }}>
                  {files.map((f, idx) => <li key={idx}>{f.name}</li>)}
                </ul>
              </div>
            )}
            
            {showSuccess && (
              <div style={{ color: '#155724', backgroundColor: '#d4edda', padding: '15px', borderRadius: '8px', marginBottom: '20px', fontWeight: 'bold' }}>
                <CheckCircle size={20} style={{ verticalAlign: 'middle', marginRight: '10px' }} /> 
                Batch Processing Complete!
              </div>
            )}

            <button 
              onClick={handleUpload} 
              disabled={loading || files.length === 0}
              style={{ width: '100%', padding: '15px', backgroundColor: (loading || files.length === 0) ? '#cbd5e1' : '#4f46e5', color: 'white', border: 'none', borderRadius: '8px', cursor: (loading || files.length === 0) ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '1.1rem', marginBottom: '20px' }}
            >
              {loading ? (
                <span>
                  <Loader2 style={{ animation: 'spin 1s linear infinite', marginRight: '10px', display: 'inline' }} /> 
                  Processing {currentProgress} of {files.length}...
                </span>
              ) : (
                <>Extract {files.length > 0 ? files.length : ''} Documents</>
              )}
            </button>

            <button 
              onClick={exportToExcel}
              style={{ width: '100%', padding: '15px', backgroundColor: '#10b981', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '1.1rem' }}
            >
              <Download size={20} style={{ verticalAlign: 'middle', marginRight: '10px' }} />
              Download Consolidated Report ({data.length})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
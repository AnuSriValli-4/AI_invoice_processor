import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import * as XLSX from 'xlsx';
import { Upload, Download, CheckCircle, Loader2 } from 'lucide-react';
import './App.css';

// CHANGE THIS TO YOUR RENDER URL WHEN PUSHING TO GITHUB
const BACKEND_URL = "https://ai-invoice-processor-backend.onrender.com";

function App() {
  const [file, setFile] = useState(null);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    const loadInvoices = async () => {
      try {
        const response = await axios.get(`${BACKEND_URL}/invoices`);
        setData(response.data); 
      } catch (error) {
        console.error("History load failed:", error);
      }
    };
    loadInvoices();
  }, []);

  const chartData = React.useMemo(() => {
    const counts = data.reduce((acc, curr) => {
      const date = curr.invoice_date || 'Unknown';
      acc[date] = (acc[date] || 0) + 1;
      return acc;
    }, {});
    return Object.keys(counts).map(date => ({ date, count: counts[date] }));
  }, [data]);

  const handleUpload = async () => {
    if (!file) return alert("Select a file!");
    setLoading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await axios.post(`${BACKEND_URL}/upload`, formData);
      // Merging your successful logic: response.data.data
      const newEntry = response.data.data || response.data;
      setData(prev => [{...newEntry, status: 'Processed'}, ...prev]);
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 4000);
    } catch (error) {
      alert("Extraction failed. Ensure backend is awake!");
    } finally {
      setLoading(false);
    }
  };

  const exportToExcel = () => {
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Invoices");
    XLSX.writeFile(workbook, "Consolidated_Invoices.xlsx");
  };

  return (
    <div className="app-container">
      <header className="main-header">
        <h1>AI Invoice Intelligence</h1>
        <p>Enterprise Document Consolidation System</p>
      </header>

      <section className="dashboard-grid">
        <div className="kpi-card">
          <span className="kpi-label">Total Processed</span>
          <span className="kpi-value">{data.length}</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">System Status</span>
          <span className="kpi-value" style={{fontSize: '1.2rem', color: '#10b981'}}>Active</span>
        </div>
        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tick={{fontSize: 10}} />
              <YAxis tick={{fontSize: 10}} />
              <Tooltip />
              <Bar dataKey="count" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div className="upload-section">
        <input type="file" onChange={(e) => setFile(e.target.files[0])} />
        <button className="process-btn" onClick={handleUpload} disabled={loading}>
          {loading ? "AI Extracting..." : "Process Document"}
        </button>
      </div>

      {showSuccess && <div className="success-banner">Successfully saved to Supabase!</div>}

      <div className="action-bar">
        <button className="download-btn" onClick={exportToExcel} disabled={data.length === 0}>
          <Download size={16} /> Download Excel
        </button>
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Vendor</th>
              <th>Date</th>
              <th>Amount</th>
              <th>File</th>
            </tr>
          </thead>
          <tbody>
            {data.map((inv, i) => (
              <tr key={i}>
                <td>{inv.vendor_name || inv.vendor || "N/A"}</td>
                <td>{inv.invoice_date || "---"}</td>
                <td>{inv.total_amount || inv.amount ? `$${inv.total_amount || inv.amount}` : "$0.00"}</td>
                <td style={{fontSize: '0.7rem'}}>{inv.source_file || "Uploaded"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default App;

import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { useDropzone } from 'react-dropzone';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import * as XLSX from 'xlsx';
import { Download, Loader2 } from 'lucide-react';
import './App.css';

const BACKEND_URL = "https://ai-invoice-processor-backend.onrender.com";

function App() {
  const [data, setData] = useState([]);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  // Fetch history on load
  useEffect(() => {
    const loadInvoices = async () => {
      try {
        const response = await axios.get(`${BACKEND_URL}/invoices`);
        setData(response.data); 
      } catch (error) {
        console.error("Could not load history:", error);
      }
    };
    loadInvoices();
  }, []);

  const chartData = useMemo(() => {
    const counts = data.reduce((acc, curr) => {
      const date = curr.invoice_date || 'Unknown';
      acc[date] = (acc[date] || 0) + 1;
      return acc;
    }, {});
    return Object.keys(counts).map(date => ({ date, count: counts[date] }));
  }, [data]);

  const onDrop = (acceptedFiles) => {
    setFiles(acceptedFiles);
    setStatusMessage(`${acceptedFiles.length} files staged for AI extraction.`);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop });

  const handleUpload = async () => {
    if (files.length === 0) return;
    setLoading(true);
    setStatusMessage("AI extracting data...");
    
    for (const file of files) {
      const formData = new FormData();
      formData.append('file', file);
      try {
        const response = await axios.post(`${BACKEND_URL}/upload`, formData);
        // Flexible mapping to ensure vendor names appear
        const result = response.data.data || response.data;
        setData(prev => [{...result, status: 'Processed', source_file: file.name}, ...prev]);
      } catch (error) {
        setData(prev => [{source_file: file.name, status: 'Failed', vendor_name: 'Error'}, ...prev]);
      }
    }
    setLoading(false);
    setStatusMessage("Processing complete!");
    setFiles([]);
  };

  const exportToExcel = () => {
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Invoices");
    XLSX.writeFile(workbook, "Invoices_Report.xlsx");
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
          <span className="kpi-value">{data.filter(d => d.status !== 'Failed').length}</span>
        </div>
        <div className="kpi-card error">
          <span className="kpi-label">Failed</span>
          <span className="kpi-value">{data.filter(d => d.status === 'Failed').length}</span>
        </div>
        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tick={{fontSize: 10}} />
              <YAxis tick={{fontSize: 10}} />
              <Tooltip />
              <Bar dataKey="count" fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div {...getRootProps()} className={`dropzone-box ${isDragActive ? 'active' : ''}`}>
        <input {...getInputProps()} />
        <p className="dropzone-text">
          {files.length > 0 ? `${files.length} files ready` : "Drag & drop invoices here"}
        </p>
      </div>

      <div className="action-bar">
        <button className="process-btn" onClick={handleUpload} disabled={loading || files.length === 0}>
          {loading ? "Processing..." : "Process Documents"}
        </button>
        <button className="download-btn" onClick={exportToExcel} disabled={data.length === 0}>
          <Download size={16} /> Excel Report
        </button>
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Vendor</th>
              <th>Date</th>
              <th>Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.map((inv, i) => (
              <tr key={i}>
                <td>{inv.vendor_name || inv.vendor || "N/A"}</td>
                <td>{inv.invoice_date || "---"}</td>
                <td>{inv.total_amount || inv.amount ? `$${inv.total_amount || inv.amount}` : "$0.00"}</td>
                <td><span className={`badge ${inv.status || 'Processed'}`}>{inv.status || 'Processed'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {statusMessage && <div className="status-banner">{statusMessage}</div>}
    </div>
  );
}

export default App;

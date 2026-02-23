import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { useDropzone } from 'react-dropzone';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import * as XLSX from 'xlsx';
import { Download } from 'lucide-react';
import './App.css';

const BACKEND_URL = "https://ai-invoice-processor-backend.onrender.com";

function App() {
  const [data, setData] = useState([]);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => {
    const loadInvoices = async () => {
      try {
        const response = await axios.get(`${BACKEND_URL}/invoices`);
        const normalized = response.data.map(inv => ({ ...inv, status: inv.status || "Processed" }));
        setData(normalized);
      } catch (error) {
        console.error("Could not load history:", error);
        setStatusMessage("Could not connect to server.");
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
    return Object.keys(counts)
      .map(date => ({ date, count: counts[date] }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [data]);

  const onDrop = (acceptedFiles) => {
    setFiles(acceptedFiles);
    setStatusMessage(`${acceptedFiles.length} file(s) staged for processing.`);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.tiff', '.bmp'] }
  });

  const handleUpload = async () => {
    if (files.length === 0) return;
    setLoading(true);
    setStatusMessage(`Processing ${files.length} file(s)...`);

    const results = [];
    for (const file of files) {
      const formData = new FormData();
      formData.append('file', file);
      try {
        const response = await axios.post(`${BACKEND_URL}/upload`, formData);
        const result = response.data.data || response.data;
        results.push({ ...result, status: 'Processed', source_file: file.name });
      } catch (error) {
        console.error(`Failed to process ${file.name}:`, error);
        results.push({ source_file: file.name, status: 'Failed', vendor_name: 'Error' });
      }
    }

    setData(prev => [...results, ...prev]);
    setLoading(false);
    setStatusMessage(`Done! ${results.filter(r => r.status === 'Processed').length} processed, ${results.filter(r => r.status === 'Failed').length} failed.`);
    setFiles([]);
  };

  const exportToExcel = () => {
    const exportData = data.map(inv => ({
      'Invoice #': inv.invoice_number || '',
      'Vendor': inv.vendor_name || '',
      'Date': inv.invoice_date || '',
      'Pre-Tax Amount': inv.amount ?? '',
      'Tax Amount': inv.tax_amount ?? '',
      'Total Amount': inv.total_amount ?? '',
      'Payment Status': inv.payment_status || '',
      'File': inv.source_file || '',
      'Status': inv.status || '',
    }));
    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Invoices");
    XLSX.writeFile(workbook, "Invoices_Report.xlsx");
  };

  const formatCurrency = (value) => {
    if (value === null || value === undefined || value === '') return '—';
    return `$${parseFloat(value).toFixed(2)}`;
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
        <div className="kpi-card">
          <span className="kpi-label">Total Value</span>
          <span className="kpi-value">
            {formatCurrency(data.reduce((sum, d) => sum + (parseFloat(d.total_amount) || 0), 0))}
          </span>
        </div>
        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="count" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div {...getRootProps()} className={`dropzone-box ${isDragActive ? 'active' : ''}`}>
        <input {...getInputProps()} />
        <p className="dropzone-text">
          {isDragActive ? 'Drop files here...' : files.length > 0 ? `${files.length} file(s) ready to process` : 'Drag & drop invoice images here, or click to select'}
        </p>
      </div>

      <div className="action-bar">
        <button className="process-btn" onClick={handleUpload} disabled={loading || files.length === 0}>
          {loading ? "Processing..." : `Process ${files.length > 0 ? files.length : ''} Document(s)`}
        </button>
        <button className="download-btn" onClick={exportToExcel} disabled={data.length === 0}>
          <Download size={16} /> Excel Report
        </button>
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Invoice #</th>
              <th>Vendor</th>
              <th>Date</th>
              <th>Pre-Tax</th>
              <th>Tax</th>
              <th>Total</th>
              <th>Payment</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr><td colSpan={8} style={{textAlign:'center', padding:'2rem', opacity:0.5}}>No invoices yet</td></tr>
            ) : data.map((inv, i) => (
              <tr key={inv.id || i}>
                <td>{inv.invoice_number || '—'}</td>
                <td>{inv.vendor_name || inv.vendor || '—'}</td>
                <td>{inv.invoice_date || '—'}</td>
                <td>{formatCurrency(inv.amount)}</td>
                <td>{formatCurrency(inv.tax_amount)}</td>
                <td>{formatCurrency(inv.total_amount)}</td>
                <td>{inv.payment_status || '—'}</td>
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

import React, { useState, useMemo } from 'react';
import { useDropzone } from 'react-dropzone';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import * as XLSX from 'xlsx';
import './App.css';

const BACKEND_URL = "https://ai-invoice-processor-backend.onrender.com";

function App() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  // Count invoices by date
  const chartData = useMemo(() => {
    const counts = data.reduce((acc, curr) => {
      const date = curr.invoice_date || 'Unknown';
      acc[date] = (acc[date] || 0) + 1;
      return acc;
    }, {});
    return Object.keys(counts).map(date => ({ date, count: counts[date] }));
  }, [data]);

  const onDrop = async (acceptedFiles) => {
    setLoading(true);
    setStatusMessage(`Processing ${acceptedFiles.length} files...`);
    
    for (const file of acceptedFiles) {
      const formData = new FormData();
      formData.append('file', file);

      try {
        const response = await fetch(`${BACKEND_URL}/upload`, {
          method: 'POST',
          body: formData,
        });
        const result = await response.json();
        setData(prev => [...prev, { ...result, source_file: file.name, status: 'Processed' }]);
      } catch (error) {
        console.error("Error uploading file:", file.name);
        setData(prev => [...prev, { source_file: file.name, status: 'Failed', vendor_name: 'Error' }]);
      }
    }
    
    setLoading(false);
    setStatusMessage("Processing complete!"); 
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop });

  const exportToExcel = () => {
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Invoices");
    XLSX.writeFile(workbook, "Consolidated_Invoices.xlsx");
  };

  const unprocessedCount = data.filter(d => d.status === 'Failed').length;

  return (
    <div className="app-container">
      <header className="main-header">
        <h1>AI Invoice Intelligence</h1>
        <p>Enterprise Document Consolidation System</p>
      </header>

      {/* KPI Dashboard Section */}
      <section className="dashboard-grid">
        <div className="kpi-card">
          <h3>Total Processed</h3>
          <p className="kpi-value">{data.filter(d => d.status === 'Processed').length}</p>
        </div>
        <div className="kpi-card error">
          <h3>Unprocessed / Failed</h3>
          <p className="kpi-value">{unprocessedCount}</p>
        </div>
        <div className="chart-container">
          <h3>Volume Trend by Date</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="count" fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Upload Zone */}
      <div {...getRootProps()} className={`dropzone-box ${isDragActive ? 'active' : ''}`}>
        <input {...getInputProps()} />
        <div className="dropzone-content">
          <span className="icon">📁</span>
          <p>Drag & drop invoices or click to browse</p>
        </div>
      </div>

      {statusMessage && <div className="status-banner">{statusMessage}</div>}

      <div className="action-bar">
        <button className="download-btn" onClick={exportToExcel} disabled={data.length === 0}>
          Download Excel Report
        </button>
      </div>

      {/* Data Preview Table */}
      <section className="preview-table-section">
        <h3>Data Preview</h3>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Date</th>
                <th>Amount</th>
                <th>Source File</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => (
                <tr key={i}>
                  <td>{row.vendor_name || '---'}</td>
                  <td>{row.invoice_date || '---'}</td>
                  <td>{row.total_amount ? `$${row.total_amount}` : '---'}</td>
                  <td>{row.source_file}</td>
                  <td><span className={`badge ${row.status}`}>{row.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default App;

import React, { useState, useMemo } from 'react';
import { useDropzone } from 'react-dropzone';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import * as XLSX from 'xlsx';
import './App.css';

const BACKEND_URL = "https://ai-invoice-processor-backend.onrender.com";

function App() {
  const [data, setData] = useState([]);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

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
    setStatusMessage(`${acceptedFiles.length} files ready for processing.`);
  };

  const handleUpload = async () => {
    if (files.length === 0) return;
    setLoading(true);
    setStatusMessage(`Processing ${files.length} files...`);
    
    for (const file of files) {
      const formData = new FormData();
      formData.append('file', file);

      try {
        const response = await fetch(`${BACKEND_URL}/upload`, {
          method: 'POST',
          body: formData,
        });
        const result = await response.json();

        // FIX: Mapping result.data to the table state for correct tracking
        if (result.status === "Success") {
          setData(prev => [{ ...result.data, status: 'Processed' }, ...prev]);
        } else {
          setData(prev => [{ source_file: file.name, status: 'Failed', vendor_name: 'Error' }, ...prev]);
        }
      } catch (error) {
        setData(prev => [{ source_file: file.name, status: 'Failed', vendor_name: 'Error' }, ...prev]);
      }
    }
    setLoading(false);
    setStatusMessage("Processing complete!");
    setFiles([]);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop });

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
          <h3>Total Processed</h3>
          <p className="kpi-value">{data.filter(d => d.status === 'Processed').length}</p>
        </div>
        <div className="kpi-card error">
          <h3>Unprocessed / Failed</h3>
          <p className="kpi-value">{data.filter(d => d.status === 'Failed').length}</p>
        </div>
        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="count" fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div {...getRootProps()} className={`dropzone-box ${isDragActive ? 'active' : ''}`}>
        <input {...getInputProps()} />
        <p>{files.length > 0 ? `${files.length} files selected` : "Drag & drop invoices or click to browse"}</p>
      </div>

      <div className="action-bar">
        <button className="process-btn" onClick={handleUpload} disabled={loading || files.length === 0}>
          {loading ? "Processing..." : "Process Documents"}
        </button>
        <button className="download-btn" onClick={exportToExcel} disabled={data.length === 0}>
          Download Excel Report
        </button>
      </div>

      <section className="table-section">
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

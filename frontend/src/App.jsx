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
    setStatusMessage(`${acceptedFiles.length} files staged. Click 'Process Documents' to begin.`);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop });

  const handleUpload = async () => {
    if (files.length === 0) return;
    setLoading(true);
    setStatusMessage("Extracting intelligence from documents...");
    
    for (const file of files) {
      const formData = new FormData();
      formData.append('file', file);

      try {
        const response = await fetch(`${BACKEND_URL}/upload`, {
          method: 'POST',
          body: formData,
        });
        
        const result = await response.json();

        // Mapped specifically to your Supabase schema: vendor_name, invoice_date, total_amount
        if (result.status === "Success" && result.data) {
          setData(prev => [{
            vendor_name: result.data.vendor_name || 'Unknown',
            invoice_date: result.data.invoice_date || 'N/A',
            total_amount: result.data.total_amount || 0,
            source_file: file.name,
            status: 'Processed'
          }, ...prev]);
        } else {
          setData(prev => [{ source_file: file.name, status: 'Failed', vendor_name: 'Auth Error' }, ...prev]);
        }
      } catch (error) {
        setData(prev => [{ source_file: file.name, status: 'Failed', vendor_name: 'Connection Error' }, ...prev]);
      }
    }
    setLoading(false);
    setStatusMessage("All files processed and saved to Supabase.");
    setFiles([]);
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
          <span className="kpi-value">{data.filter(d => d.status === 'Processed').length}</span>
        </div>
        <div className="kpi-card error">
          <span className="kpi-label">Processing Issues</span>
          <span className="kpi-value">{data.filter(d => d.status === 'Failed').length}</span>
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

      <div {...getRootProps()} className={`dropzone-box ${isDragActive ? 'active' : ''}`}>
        <input {...getInputProps()} />
        <p className="dropzone-text">
          {files.length > 0 ? `${files.length} files selected` : "Drag & drop invoices or click to browse"}
        </p>
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
                <th>Vendor Name</th>
                <th>Invoice Date</th>
                <th>Total Amount</th>
                <th>Source File</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => (
                <tr key={i}>
                  <td className="vendor-cell">{row.vendor_name}</td>
                  <td>{row.invoice_date}</td>
                  <td className="amount-cell">{row.total_amount ? `$${row.total_amount}` : '---'}</td>
                  <td className="file-cell">{row.source_file}</td>
                  <td><span className={`badge ${row.status}`}>{row.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {statusMessage && <div className="status-footer">{statusMessage}</div>}
    </div>
  );
}

export default App;

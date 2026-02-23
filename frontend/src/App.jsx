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

  //Count invoices by date
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

        if (result.status === "Success") {
          setData(prev => [...prev, { ...result.data, status: 'Processed' }]);
        } else {
          setData(prev => [...prev, { source_file: file.name, status: 'Failed', vendor_name: 'Error' }]);
        }
      } catch (error) {
        console.error("Error uploading file:", file.name);
        setData(prev => [...prev, { source_file: file.name, status: 'Failed', vendor_name: 'Error' }]);
      }
    }
    
    setLoading(false);
    setStatusMessage("Processing complete!");
    setFiles([]); // Clear queue after processing
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop });

  const exportToExcel = () => {
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Invoices");
    XLSX.writeFile(workbook, "Consolidated_Invoices.xlsx");
  };

  const processedCount = data.filter(d => d.status === 'Processed').length;
  const failedCount = data.filter(d => d.status === 'Failed').length;

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
          <p className="kpi-value">{processedCount}</p>
        </div>
        <div className="kpi-card error">
          <h3>Failed</h3>
          <p className="kpi-value">{failedCount}</p>
        </div>
        <div className="chart-container">
          <h3>Volume Trend by Date</h3>
          <ResponsiveContainer width="100%" height="100%">
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
      <div {...getRootProps()} className={`dropzone-box ${isDragActive ? 'active' :

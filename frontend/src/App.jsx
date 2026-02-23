import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { useDropzone } from 'react-dropzone';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import * as XLSX from 'xlsx';
import { Download, FileText, DollarSign, AlertCircle, CheckCircle2, UploadCloud } from 'lucide-react';
import './App.css';

const BACKEND_URL = "https://ai-invoice-processor-backend.onrender.com";

const formatCurrency = (value) => {
  if (value === null || value === undefined || value === '') return '—';
  const num = parseFloat(value);
  if (isNaN(num)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num);
};

export default function App() {
  const [data, setData] = useState([]);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [statusType, setStatusType] = useState('info');
  const [processingFile, setProcessingFile] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await axios.get(`${BACKEND_URL}/invoices`);
        setData(res.data.map(inv => ({ ...inv, status: 'Processed' })));
      } catch (e) {
        console.error('Failed to load invoices', e);
        setStatus('Could not connect to server.', 'error');
      }
    })();
  }, []);

  const setStatus = (msg, type = 'info') => {
    setStatusMessage(msg);
    setStatusType(type);
  };

  const chartData = useMemo(() => {
    const counts = {};
    data.filter(d => d.status !== 'Failed').forEach(inv => {
      const date = inv.invoice_date && inv.invoice_date !== 'Unknown' ? inv.invoice_date : null;
      if (!date) return;
      counts[date] = (counts[date] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-10);
  }, [data]);

  const totalValue = useMemo(() =>
    data.filter(d => d.status !== 'Failed')
      .reduce((s, d) => s + (parseFloat(d.total_amount) || 0), 0),
  [data]);

  const onDrop = (acceptedFiles) => {
    setFiles(acceptedFiles);
    setStatus(`${acceptedFiles.length} file(s) ready — click Process to begin.`, 'info');
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.tiff', '.bmp', '.webp'],
      'application/pdf': ['.pdf'],
    },
  });

  const handleUpload = async () => {
    if (!files.length || loading) return;
    setLoading(true);
    const results = [];

    for (const file of files) {
      setProcessingFile(file.name);
      setStatus(`Extracting data from "${file.name}"…`, 'info');
      const formData = new FormData();
      formData.append('file', file);
      try {
        const res = await axios.post(`${BACKEND_URL}/upload`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 60000,
        });
        const result = res.data.data || res.data;
        results.push({ ...result, status: 'Processed', source_file: file.name });
      } catch (err) {
        console.error(`Error processing ${file.name}:`, err?.response?.data || err.message);
        results.push({ source_file: file.name, status: 'Failed', vendor_name: 'Error — see console' });
      }
    }

    setData(prev => [...results, ...prev]);
    setFiles([]);
    setProcessingFile('');
    setLoading(false);
    const ok = results.filter(r => r.status === 'Processed').length;
    const fail = results.filter(r => r.status === 'Failed').length;
    if (fail === 0) setStatus(`✓ All ${ok} invoice(s) processed successfully!`, 'success');
    else setStatus(`Processed ${ok} • Failed ${fail} — open console for error details.`, 'error');
  };

  const exportToExcel = () => {
    const rows = data.map(inv => ({
      'Invoice #':      inv.invoice_number || '',
      'Vendor':         inv.vendor_name || '',
      'Date':           inv.invoice_date || '',
      'Pre-Tax Amount': inv.amount ?? '',
      'Tax Amount':     inv.tax_amount ?? '',
      'Total Amount':   inv.total_amount ?? '',
      'Payment Status': inv.payment_status || '',
      'Source File':    inv.source_file || '',
      'Status':         inv.status || '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Invoices');
    XLSX.writeFile(wb, 'Invoices_Report.xlsx');
  };

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload?.length) {
      return (
        <div className="chart-tooltip">
          <p className="tooltip-date">{label}</p>
          <p className="tooltip-value">{payload[0].value} invoice{payload[0].value !== 1 ? 's' : ''}</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="app-container">
      <header className="main-header">
        <div className="header-inner">
          <div className="header-icon"><FileText size={20} /></div>
          <div>
            <h1>AI Invoice Intelligence</h1>
            <p>Enterprise Document Consolidation System</p>
          </div>
        </div>
      </header>

      {/* KPI Row */}
      <div className="kpi-row">
        <div className="kpi-card">
          <div className="kpi-icon success-icon"><CheckCircle2 size={16} /></div>
          <div>
            <span className="kpi-label">Total Processed</span>
            <span className="kpi-value">{data.filter(d => d.status !== 'Failed').length}</span>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon error-icon"><AlertCircle size={16} /></div>
          <div>
            <span className="kpi-label">Failed</span>
            <span className="kpi-value error-value">{data.filter(d => d.status === 'Failed').length}</span>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon money-icon"><DollarSign size={16} /></div>
          <div>
            <span className="kpi-label">Total Value</span>
            <span className="kpi-value money-value">{formatCurrency(totalValue)}</span>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="chart-section">
        <p className="chart-title">Invoices by Date</p>
        {chartData.length === 0 ? (
          <div className="chart-empty">No dated invoices to display yet</div>
        ) : (
          <ResponsiveContainer width="100%" height={120}>
            <AreaChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="count" stroke="#10b981" strokeWidth={2} fill="url(#colorCount)" dot={{ r: 3, fill: '#10b981', strokeWidth: 0 }} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Upload Zone */}
      <div
        {...getRootProps()}
        className={`dropzone-box ${isDragActive ? 'dropzone-active' : ''} ${files.length > 0 ? 'dropzone-ready' : ''}`}
      >
        <input {...getInputProps()} />
        <UploadCloud size={20} className="dropzone-icon" />
        <p className="dropzone-text">
          {isDragActive
            ? 'Drop files here…'
            : files.length > 0
            ? `${files.length} file(s) staged — ${files.map(f => f.name).join(', ')}`
            : 'Drag & drop invoices here, or click to select'}
        </p>
        <p className="dropzone-hint">Supports PNG, JPG, TIFF, WEBP, PDF</p>
      </div>

      {/* Actions */}
      <div className="action-bar">
        <button className="process-btn" onClick={handleUpload} disabled={loading || files.length === 0}>
          {loading ? (
            <span className="btn-loading">
              <span className="spinner" />
              {processingFile ? `Processing "${processingFile}"…` : 'Processing…'}
            </span>
          ) : (
            `Process ${files.length > 0 ? files.length + ' ' : ''}Document${files.length !== 1 ? 's' : ''}`
          )}
        </button>
        <button className="download-btn" onClick={exportToExcel} disabled={data.length === 0}>
          <Download size={15} /> Export Excel
        </button>
      </div>

      {/* Status Banner */}
      {statusMessage && (
        <div className={`status-banner status-${statusType}`}>
          {statusType === 'success' && <CheckCircle2 size={13} />}
          {statusType === 'error' && <AlertCircle size={13} />}
          {statusMessage}
        </div>
      )}

      {/* Table */}
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
              <tr>
                <td colSpan={8} className="table-empty">No invoices yet — upload some documents above</td>
              </tr>
            ) : (
              data.map((inv, i) => (
                <tr key={inv.id || i} className={inv.status === 'Failed' ? 'row-failed' : ''}>
                  <td className="td-mono">{inv.invoice_number || '—'}</td>
                  <td className="td-vendor">{inv.vendor_name || inv.vendor || '—'}</td>
                  <td className="td-mono">{inv.invoice_date || '—'}</td>
                  <td>{formatCurrency(inv.amount)}</td>
                  <td>{formatCurrency(inv.tax_amount)}</td>
                  <td className="td-total">{formatCurrency(inv.total_amount)}</td>
                  <td>
                    {inv.payment_status ? (
                      <span className={`badge badge-payment badge-${(inv.payment_status || '').toLowerCase()}`}>
                        {inv.payment_status}
                      </span>
                    ) : '—'}
                  </td>
                  <td>
                    <span className={`badge badge-${(inv.status || 'processed').toLowerCase()}`}>
                      {inv.status === 'Failed'
                        ? <><AlertCircle size={10} style={{marginRight:3}}/> Failed</>
                        : <><CheckCircle2 size={10} style={{marginRight:3}}/> Processed</>}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';

export default function TestPage() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/exam-data')
      .then(r => r.json())
      .then(data => { setResult(data); setLoading(false); })
      .catch(err => { setResult({ success: false, message: String(err) }); setLoading(false); });
  }, []);

  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: 700, margin: '40px auto', padding: 20 }}>
      <h1>Tes Koneksi ke Google Sheets</h1>
      <p style={{ color: '#64748b' }}>
        Halaman ini cuma buat ngetes Tahap 2 — memastikan Vercel bisa baca Spreadsheet ujian kamu.
      </p>

      {loading && <p>Memuat...</p>}

      {!loading && result && result.success && (
        <div style={{ background: '#dcfce7', border: '1px solid #86efac', borderRadius: 10, padding: 16 }}>
          <b style={{ color: '#166534' }}>✅ Berhasil! Koneksi ke Google Sheets jalan.</b>
          <p>Ditemukan {result.totalUjian} ujian di sheet "Exams":</p>
          <ul>
            {result.data.map((e, i) => (
              <li key={i}>{e.subject} — Kelas {e.class} (ID: {e.id})</li>
            ))}
          </ul>
        </div>
      )}

      {!loading && result && !result.success && (
        <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 10, padding: 16 }}>
          <b style={{ color: '#991b1b' }}>❌ Gagal.</b>
          <p>{result.message}</p>
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';

export default function TestExamPage() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const examId = params.get('examId');
    const uid = params.get('uid');
    const token = params.get('token');

    if (!examId || !uid || !token) {
      setResult({ success: false, message: 'URL harus ada ?examId=...&uid=...&token=...' });
      setLoading(false);
      return;
    }

    fetch(`/api/start-exam?examId=${encodeURIComponent(examId)}&uid=${encodeURIComponent(uid)}&token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(data => { setResult(data); setLoading(false); })
      .catch(err => { setResult({ success: false, message: String(err) }); setLoading(false); });
  }, []);

  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: 700, margin: '40px auto', padding: 20 }}>
      <h1>Tes Tahap 3a: Validasi Siswa + Load Soal</h1>

      {loading && <p>Memuat...</p>}

      {!loading && result && result.success && (
        <div style={{ background: '#dcfce7', border: '1px solid #86efac', borderRadius: 10, padding: 16 }}>
          <b style={{ color: '#166534' }}>✅ Berhasil!</b>
          <p><b>Siswa:</b> {result.student.name} (Kelas {result.student.class})</p>
          <p><b>Ujian:</b> {result.exam.subject} — Kelas {result.exam.class}</p>
          <p><b>Durasi:</b> {result.exam.durationMinutes} menit — Status: {result.exam.status}</p>
          <p><b>Jumlah Soal:</b> {result.totalSoal}</p>
          <ol>
            {result.questions.map((q, i) => (
              <li key={i}>[{q.type}] {String(q.content).replace(/<[^>]+>/g, '').slice(0, 70)}...</li>
            ))}
          </ol>
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

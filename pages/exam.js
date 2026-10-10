import { useEffect, useRef, useState } from 'react';
import Head from 'next/head';

/* ---------- Kamera inline (tanpa popup/iframe) ---------- */
function CameraCapture({ onUse, onCancel }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [cams, setCams] = useState([]);
  const [camIndex, setCamIndex] = useState(0);
  const [err, setErr] = useState('');
  const [shot, setShot] = useState(null);

  function stopStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }

  async function startCamera(deviceId) {
    stopStream();
    setErr('');
    try {
      const constraints = deviceId
        ? { video: { deviceId: { exact: deviceId } }, audio: false }
        : { video: true, audio: false };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      const devices = await navigator.mediaDevices.enumerateDevices();
      setCams(devices.filter(d => d.kind === 'videoinput'));
    } catch (e) {
      let msg = 'Tidak bisa mengakses kamera.';
      if (e.name === 'NotAllowedError') msg = 'Izin kamera ditolak. Aktifkan izin kamera untuk situs ini di pengaturan browser.';
      else if (e.name === 'NotFoundError') msg = 'Kamera tidak ditemukan di perangkat ini.';
      else if (e.name === 'NotReadableError') msg = 'Kamera sedang dipakai aplikasi/tab lain.';
      setErr(msg + ' (' + (e.name || 'Error') + ')');
    }
  }

  useEffect(() => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setErr('Browser ini tidak mendukung kamera. Gunakan Chrome/Safari versi terbaru.');
      return;
    }
    startCamera(null);
    return () => stopStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function switchCam() {
    if (cams.length < 2) return;
    const next = (camIndex + 1) % cams.length;
    setCamIndex(next);
    startCamera(cams[next].deviceId);
  }

  function capture() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const MAX_W = 1000;
    const scale = Math.min(1, MAX_W / v.videoWidth);
    const c = document.createElement('canvas');
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    setShot(c.toDataURL('image/jpeg', 0.6));
    stopStream();
  }

  function retake() {
    setShot(null);
    startCamera(cams[camIndex] ? cams[camIndex].deviceId : null);
  }

  return (
    <div style={{ background: '#0f172a', borderRadius: 14, overflow: 'hidden' }}>
      {err ? (
        <div style={{ color: '#fff', padding: 24, textAlign: 'center' }}>
          <p>🚫 {err}</p>
          <button style={btn('#2563eb')} onClick={() => startCamera(null)}>Coba Lagi</button>
        </div>
      ) : shot ? (
        <img src={shot} alt="Hasil foto" style={{ width: '100%', display: 'block', maxHeight: 420, objectFit: 'contain', background: '#000' }} />
      ) : (
        <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', display: 'block', maxHeight: 420, background: '#000' }} />
      )}

      <div style={{ display: 'flex', gap: 8, padding: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
        {!shot && !err && (
          <>
            {cams.length > 1 && <button style={btn('#475569')} onClick={switchCam}>⟲ Ganti Kamera</button>}
            <button style={btn('#fff', '#0f172a')} onClick={capture}>📸 Ambil Foto</button>
          </>
        )}
        {shot && (
          <>
            <button style={btn('#475569')} onClick={retake}>Foto Ulang</button>
            <button style={btn('#16a34a')} onClick={() => onUse(shot)}>Gunakan Foto Ini</button>
          </>
        )}
        <button style={btn('#334155')} onClick={() => { stopStream(); onCancel(); }}>Tutup</button>
      </div>
    </div>
  );
}

function btn(bg, color) {
  return { background: bg, color: color || '#fff', border: 'none', borderRadius: 10, padding: '10px 16px', fontWeight: 700, fontSize: 14, cursor: 'pointer' };
}

/* ---------- Halaman ujian ---------- */
export default function ExamPage() {
  const [status, setStatus] = useState('loading'); // loading | error | ready | timeup
  const [errMsg, setErrMsg] = useState('');
  const [data, setData] = useState(null);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState({}); // { qid: { mode, text, photo } }
  const [cameraOpen, setCameraOpen] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(null);
  const storageKeys = useRef({});

  // Muat data ujian
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const examId = p.get('examId'), uid = p.get('uid'), token = p.get('token');
    if (!examId || !uid || !token) {
      setErrMsg('Link ujian tidak lengkap. Mulai ujian dari aplikasi utama.');
      setStatus('error');
      return;
    }
    fetch(`/api/start-exam?examId=${encodeURIComponent(examId)}&uid=${encodeURIComponent(uid)}&token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(res => {
        if (!res.success) { setErrMsg(res.message || 'Gagal memuat ujian.'); setStatus('error'); return; }

        const ansKey = `exam_answers_${examId}_${uid}`;
        const startKey = `exam_start_${examId}_${uid}`;
        storageKeys.current = { ansKey, startKey };

        try {
          const saved = localStorage.getItem(ansKey);
          if (saved) setAnswers(JSON.parse(saved));
        } catch (e) {}

        let start = parseInt(localStorage.getItem(startKey) || '0', 10);
        if (!start) { start = Date.now(); localStorage.setItem(startKey, String(start)); }
        const total = Math.round(res.exam.durationMinutes * 60);
        const left = total - Math.floor((Date.now() - start) / 1000);
        setSecondsLeft(Math.max(0, left));

        setData(res);
        setStatus(left <= 0 ? 'timeup' : 'ready');
      })
      .catch(e => { setErrMsg(String(e)); setStatus('error'); });
  }, []);

  // Timer
  useEffect(() => {
    if (status !== 'ready') return;
    const t = setInterval(() => {
      setSecondsLeft(s => {
        if (s === null) return s;
        if (s <= 1) { clearInterval(t); setStatus('timeup'); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [status]);

  // Simpan jawaban sementara ke browser
  useEffect(() => {
    if (status !== 'ready' && status !== 'timeup') return;
    const k = storageKeys.current.ansKey;
    if (!k) return;
    try { localStorage.setItem(k, JSON.stringify(answers)); } catch (e) {}
  }, [answers, status]);

  // Render ulang rumus saat ganti soal
  useEffect(() => {
    if (status === 'ready' && window.MathJax && window.MathJax.typesetPromise) {
      window.MathJax.typesetPromise().catch(() => {});
    }
  }, [idx, status, cameraOpen]);

  function getAns(qid) {
    return answers[qid] || { mode: 'text', text: '', photo: '' };
  }
  function setAns(qid, patch) {
    setAnswers(prev => ({ ...prev, [qid]: { ...getAns(qid), ...prev[qid], ...patch } }));
  }
  function isAnswered(qid) {
    const a = answers[qid];
    return !!(a && ((a.text && a.text.trim()) || a.photo));
  }

  function fmt(s) {
    const m = Math.floor(s / 60), r = s % 60;
    return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
  }

  if (status === 'loading') return <Center>Memuat ujian...</Center>;
  if (status === 'error') return <Center><b style={{ color: '#b91c1c' }}>❌ {errMsg}</b></Center>;

  const q = data.questions[idx];
  const a = getAns(q.id);
  const answeredCount = data.questions.filter(x => isAnswered(x.id)).length;
  const lowTime = secondsLeft !== null && secondsLeft <= 300;

  return (
    <>
      <Head>
        <title>{data.exam.subject} | Ujian</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script dangerouslySetInnerHTML={{ __html: "window.MathJax={tex:{inlineMath:[['$','$'],['\\\\(','\\\\)']],displayMath:[['$$','$$'],['\\\\[','\\\\]']]},svg:{fontCache:'global'}};" }} />
        <script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js" async />
      </Head>

      <div style={{ fontFamily: '-apple-system, Segoe UI, Roboto, Arial, sans-serif', background: '#f1f5f9', minHeight: '100vh' }}>
        {/* Header */}
        <div style={{ background: '#2b369e', color: '#fff', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, zIndex: 10 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{data.exam.subject}</div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>{data.student.name} • Kelas {data.student.class.toUpperCase()}</div>
          </div>
          <div style={{ background: lowTime ? '#dc2626' : 'rgba(255,255,255,0.15)', borderRadius: 10, padding: '8px 12px', fontWeight: 700, fontFamily: 'monospace', fontSize: 16 }}>
            ⏱ {fmt(secondsLeft || 0)}
          </div>
        </div>

        <div style={{ maxWidth: 760, margin: '0 auto', padding: 16 }}>
          {status === 'timeup' && (
            <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 12, padding: 14, marginBottom: 14, color: '#991b1b', fontWeight: 600 }}>
              ⏰ Waktu ujian sudah habis. Jawaban tidak bisa diubah lagi.
            </div>
          )}

          {/* Kartu soal */}
          <div style={{ background: '#fff', borderRadius: 14, padding: 18, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#2563eb', marginBottom: 8 }}>
              SOAL {idx + 1} DARI {data.totalSoal} • ESAI (nilai maks. {q.point})
            </div>

            <div style={{ fontSize: 16, lineHeight: 1.6, color: '#0f172a' }} dangerouslySetInnerHTML={{ __html: q.content }} />
            {q.image ? <img src={q.image} alt="Gambar soal" style={{ maxWidth: '100%', marginTop: 10, borderRadius: 8 }} /> : null}

            {/* Pilihan mode jawaban */}
            <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
              {[['text', '⌨️ Ketik Jawaban'], ['photo', '📷 Foto Jawaban']].map(([m, label]) => (
                <button key={m}
                  disabled={status === 'timeup'}
                  onClick={() => { setAns(q.id, { mode: m }); setCameraOpen(false); }}
                  style={{ flex: 1, padding: '10px 8px', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer',
                    border: a.mode === m ? '2px solid #2563eb' : '2px solid #e2e8f0',
                    background: a.mode === m ? '#eff6ff' : '#fff', color: a.mode === m ? '#1d4ed8' : '#475569' }}>
                  {label}
                </button>
              ))}
            </div>

            <div style={{ marginTop: 12 }}>
              {a.mode === 'text' ? (
                <textarea
                  disabled={status === 'timeup'}
                  value={a.text || ''}
                  onChange={e => setAns(q.id, { text: e.target.value })}
                  placeholder="Ketik jawaban Anda di sini..."
                  style={{ width: '100%', minHeight: 160, boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 12, padding: 12, fontSize: 15, lineHeight: 1.5, fontFamily: 'inherit', resize: 'vertical' }}
                />
              ) : (
                <div>
                  {cameraOpen ? (
                    <CameraCapture
                      onUse={photo => { setAns(q.id, { photo }); setCameraOpen(false); }}
                      onCancel={() => setCameraOpen(false)}
                    />
                  ) : a.photo ? (
                    <div>
                      <img src={a.photo} alt="Foto jawaban" style={{ width: '100%', borderRadius: 12, border: '1px solid #e2e8f0' }} />
                      {status !== 'timeup' && (
                        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                          <button style={btn('#2563eb')} onClick={() => setCameraOpen(true)}>Foto Ulang</button>
                          <button style={btn('#dc2626')} onClick={() => setAns(q.id, { photo: '' })}>Hapus Foto</button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <button disabled={status === 'timeup'} style={{ ...btn('#2563eb'), width: '100%', padding: 16 }} onClick={() => setCameraOpen(true)}>
                      📷 Buka Kamera
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Navigasi */}
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button style={{ ...btn('#e2e8f0', '#334155'), flex: 1, opacity: idx === 0 ? 0.5 : 1 }}
              disabled={idx === 0} onClick={() => { setIdx(idx - 1); setCameraOpen(false); }}>
              ← Sebelumnya
            </button>
            <button style={{ ...btn('#2563eb'), flex: 1, opacity: idx === data.totalSoal - 1 ? 0.5 : 1 }}
              disabled={idx === data.totalSoal - 1} onClick={() => { setIdx(idx + 1); setCameraOpen(false); }}>
              Berikutnya →
            </button>
          </div>

          {/* Kotak nomor soal */}
          <div style={{ background: '#fff', borderRadius: 14, padding: 14, marginTop: 14, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#475569', marginBottom: 8 }}>
              Nomor Soal ({answeredCount}/{data.totalSoal} terjawab)
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {data.questions.map((x, i) => (
                <button key={x.id} onClick={() => { setIdx(i); setCameraOpen(false); }}
                  style={{ width: 40, height: 40, borderRadius: 10, fontWeight: 700, cursor: 'pointer',
                    border: i === idx ? '2px solid #1d4ed8' : '1px solid #cbd5e1',
                    background: isAnswered(x.id) ? '#16a34a' : '#fff', color: isAnswered(x.id) ? '#fff' : '#334155' }}>
                  {i + 1}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={() => alert('Fitur kirim jawaban dibuat di Tahap 3c. Sekarang jawaban baru tersimpan sementara di browser ini.')}
            style={{ ...btn('#16a34a'), width: '100%', padding: 14, marginTop: 14, fontSize: 15 }}>
            ✅ Selesai & Kirim Jawaban
          </button>
          <p style={{ textAlign: 'center', fontSize: 12, color: '#94a3b8', marginTop: 8 }}>
            Jawaban tersimpan otomatis di perangkat ini selama Anda mengerjakan.
          </p>
        </div>
      </div>
    </>
  );
}

function Center({ children }) {
  return (
    <div style={{ fontFamily: 'sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: 24, textAlign: 'center' }}>
      <div>{children}</div>
    </div>
  );
}

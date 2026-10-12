import { useEffect, useRef, useState } from 'react';
import Head from 'next/head';

/* =====================================================================
   PENGATURAN (boleh diubah)
   ===================================================================== */
// Jumlah pelanggaran sebelum siswa didiskualifikasi.
// 1 = langsung didiskualifikasi (sama persis dengan aplikasi Apps Script).
// Saat masa uji coba, 3 lebih aman supaya tidak ada siswa terkena karena salah sentuh.
const DISQUALIFY_AFTER = 3;
const REQUIRE_FULLSCREEN = true;      // wajib layar penuh (otomatis dilewati jika perangkat tidak mendukung)
const SAVE_DEBOUNCE_MS = 3000;        // simpan 3 detik setelah siswa berhenti mengetik (sama dengan aplikasi lama)
const RETRY_SAVE_MS = 5000;           // jeda coba ulang jika gagal menyimpan
const GAS_APP_URL = process.env.NEXT_PUBLIC_GAS_APP_URL || ''; // opsional: link kembali ke aplikasi utama

/* ===================================================================== */

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function callBridge(body) {
  const r = await fetch('/api/bridge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return r.json();
}

function btn(bg, color) {
  return { background: bg, color: color || '#fff', border: 'none', borderRadius: 10, padding: '10px 16px', fontWeight: 700, fontSize: 14, cursor: 'pointer' };
}

// Bentuk jawaban yang disimpan ke sheet Responses (sama dengan aplikasi lama):
// { "<idSoal>": "teks jawaban", "<idSoal>__photo": "link foto di Drive" }
function buildPayload(answers) {
  const out = {};
  Object.keys(answers).forEach(qid => {
    const a = answers[qid];
    if (a.text && a.text.trim()) out[qid] = a.text;
    if (a.photoUrl) out[qid + '__photo'] = a.photoUrl;
  });
  return out;
}

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
      return undefined;
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

/* ---------- Halaman ujian ---------- */
export default function ExamPage() {
  // phase: loading | error | intro | exam | done | dq
  const [phase, setPhase] = useState('loading');
  const [errMsg, setErrMsg] = useState('');
  const [introMsg, setIntroMsg] = useState('');
  const [data, setData] = useState(null);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState({}); // { qid: { mode, text, photoUrl, photoPreview, uploading, uploadError } }
  const [cameraOpen, setCameraOpen] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [saveState, setSaveState] = useState('saved'); // saved | saving | unsaved | error
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [warning, setWarning] = useState(null); // { n, reason }
  const [dqReason, setDqReason] = useState('');
  const [toast, setToast] = useState('');

  const credRef = useRef({ userID: '', token: '', examID: '' });
  const answersRef = useRef({});
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const saveTimerRef = useRef(null);
  const endMsRef = useRef(0);
  const offsetRef = useRef(0);
  const submittingRef = useRef(false);
  const finishedRef = useRef(false);
  const violationsRef = useRef(0);
  const lastViolationAtRef = useRef(0);
  const warningOpenRef = useRef(false);
  const phaseRef = useRef('loading');
  const flushRef = useRef(null);

  function goPhase(p) { phaseRef.current = p; setPhase(p); }
  function showToast(msg) { setToast(msg); setTimeout(() => setToast(''), 2500); }

  /* ----- Muat data ujian ----- */
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const examID = p.get('examId'), userID = p.get('uid'), token = p.get('token');
    if (!examID || !userID || !token) {
      setErrMsg('Link ujian tidak lengkap. Mulai ujian dari aplikasi utama.');
      goPhase('error');
      return;
    }
    credRef.current = { userID, token, examID };

    callBridge({ action: 'start', ...credRef.current })
      .then(res => {
        if (!res.success) { setErrMsg(res.message || 'Gagal memuat ujian.'); goPhase('error'); return; }
        if (res.questions.some(q => String(q.type).trim() !== 'Esai')) {
          setErrMsg('Ujian ini memuat tipe soal yang belum didukung di halaman ini. Hubungi pengawas.');
          goPhase('error');
          return;
        }

        const saved = res.savedAnswers || {};
        const init = {};
        res.questions.forEach(q => {
          const text = typeof saved[q.id] === 'string' ? saved[q.id] : '';
          const photoUrl = typeof saved[q.id + '__photo'] === 'string' ? saved[q.id + '__photo'] : '';
          init[q.id] = { mode: photoUrl && !text ? 'photo' : 'text', text, photoUrl, photoPreview: '', uploading: false, uploadError: '' };
        });
        answersRef.current = init;
        setAnswers(init);

        offsetRef.current = Date.parse(res.serverNow) - Date.now();
        endMsRef.current = Date.parse(res.exam.endDate);
        setSecondsLeft(Math.max(0, Math.floor((endMsRef.current - (Date.now() + offsetRef.current)) / 1000)));

        // Lanjut ke soal pertama yang belum dijawab
        let resume = 0;
        for (let i = 0; i < res.questions.length; i++) {
          const a = init[res.questions[i].id];
          if (!(a.text.trim() || a.photoUrl)) { resume = i; break; }
          resume = i;
        }
        setIdx(resume);
        setData(res);
        goPhase('intro');
      })
      .catch(e => { setErrMsg('Gagal terhubung ke server: ' + e); goPhase('error'); });
  }, []);

  /* ----- Timer (dihitung dari jam selesai ujian, sama untuk semua siswa) ----- */
  useEffect(() => {
    if (phase !== 'exam') return undefined;
    const t = setInterval(() => {
      const left = Math.max(0, Math.floor((endMsRef.current - (Date.now() + offsetRef.current)) / 1000));
      setSecondsLeft(left);
      if (left <= 0) { clearInterval(t); autoSubmitTimeUp(); }
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  /* ----- Rumus matematika ----- */
  useEffect(() => {
    if (phase === 'exam' && window.MathJax && window.MathJax.typesetPromise) {
      window.MathJax.typesetPromise().catch(() => {});
    }
  }, [idx, phase, cameraOpen]);

  /* ----- Peringatan jika menutup halaman saat ada jawaban belum tersimpan ----- */
  useEffect(() => {
    const h = e => {
      if (phaseRef.current === 'exam' && dirtyRef.current) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);

  /* =====================  SIMPAN OTOMATIS  ===================== */
  function scheduleSave(ms) {
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { if (flushRef.current) flushRef.current(); }, ms);
  }

  async function flushSave() {
    if (finishedRef.current) return;
    if (savingRef.current) { scheduleSave(800); return; }
    if (!dirtyRef.current) return;

    savingRef.current = true;
    dirtyRef.current = false;
    setSaveState('saving');
    let failed = false;
    try {
      const res = await callBridge({ action: 'save', ...credRef.current, answers: buildPayload(answersRef.current) });
      if (!res.success) {
        if (res.code === 'LOCKED') { finishedRef.current = true; savingRef.current = false; goPhase('done'); return; }
        failed = true;
      }
    } catch (e) {
      failed = true;
    }
    savingRef.current = false;

    if (failed) {
      dirtyRef.current = true;
      setSaveState('error');
      scheduleSave(RETRY_SAVE_MS);
    } else if (dirtyRef.current) {
      setSaveState('unsaved');
      scheduleSave(SAVE_DEBOUNCE_MS);
    } else {
      setSaveState('saved');
    }
  }
  flushRef.current = flushSave;

  function updateAnswer(qid, patch) {
    const cur = answersRef.current[qid] || { mode: 'text', text: '', photoUrl: '', photoPreview: '', uploading: false, uploadError: '' };
    answersRef.current = { ...answersRef.current, [qid]: { ...cur, ...patch } };
    setAnswers(answersRef.current);
    if ('text' in patch || 'photoUrl' in patch) {
      dirtyRef.current = true;
      setSaveState('unsaved');
      scheduleSave(SAVE_DEBOUNCE_MS);
    }
  }

  async function uploadPhoto(qid, dataUrl) {
    updateAnswer(qid, { photoPreview: dataUrl, uploading: true, uploadError: '' });
    try {
      const res = await callBridge({ action: 'photo', ...credRef.current, qid, dataUrl });
      if (res.success) {
        updateAnswer(qid, { photoUrl: res.url, uploading: false, uploadError: '' });
      } else {
        updateAnswer(qid, { uploading: false, uploadError: res.message || 'Foto gagal diunggah.' });
      }
    } catch (e) {
      updateAnswer(qid, { uploading: false, uploadError: 'Koneksi bermasalah, foto belum terunggah.' });
    }
  }

  function isAnswered(qid) {
    const a = answers[qid];
    return !!(a && ((a.text && a.text.trim()) || a.photoUrl));
  }
  function anyUploading() {
    return Object.keys(answersRef.current).some(k => answersRef.current[k].uploading);
  }

  /* =====================  KIRIM JAWABAN  ===================== */
  async function submitOnce() {
    // tunggu simpan yang sedang berjalan
    for (let i = 0; i < 50 && savingRef.current; i++) await sleep(200);
    clearTimeout(saveTimerRef.current);
    const res = await callBridge({ action: 'submit', ...credRef.current, answers: buildPayload(answersRef.current) });
    return res;
  }

  function finishUi() {
    finishedRef.current = true;
    clearTimeout(saveTimerRef.current);
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    goPhase('done');
  }

  async function manualSubmit() {
    if (submittingRef.current) return;
    if (anyUploading()) { setConfirmOpen(false); showToast('Foto masih diunggah, tunggu sebentar lalu coba lagi.'); return; }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const res = await submitOnce();
      if (res.success || res.code === 'LOCKED') { setConfirmOpen(false); finishUi(); return; }
      showToast(res.message || 'Gagal mengirim jawaban. Coba lagi.');
    } catch (e) {
      showToast('Koneksi bermasalah. Coba kirim lagi.');
    }
    submittingRef.current = false;
    setSubmitting(false);
    setConfirmOpen(false);
  }

  async function autoSubmitTimeUp() {
    if (submittingRef.current || finishedRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    // beri waktu foto yang sedang diunggah (maks 10 detik)
    for (let i = 0; i < 20 && anyUploading(); i++) await sleep(500);
    for (let attempt = 0; attempt < 12; attempt++) {
      try {
        const res = await submitOnce();
        if (res.success || res.code === 'LOCKED') { finishUi(); return; }
      } catch (e) { /* coba lagi */ }
      await sleep(4000);
    }
    submittingRef.current = false;
    setSubmitting(false);
    showToast('Waktu habis, tetapi pengiriman gagal. Hubungi pengawas.');
  }

  /* =====================  ANTI-CHEAT  ===================== */
  async function requestFs() {
    const el = document.documentElement;
    if (REQUIRE_FULLSCREEN && el.requestFullscreen) {
      try { await el.requestFullscreen(); } catch (e) { /* ditangani pemanggil */ }
    }
  }

  async function startExam() {
    setIntroMsg('');
    await requestFs();
    if (REQUIRE_FULLSCREEN && document.documentElement.requestFullscreen && !document.fullscreenElement) {
      setIntroMsg('Mode layar penuh wajib. Izinkan layar penuh lalu tekan tombol lagi.');
      return;
    }
    goPhase('exam');
  }

  async function handleViolation(reason) {
    if (phaseRef.current !== 'exam' || finishedRef.current) return;
    const now = Date.now();
    if (now - lastViolationAtRef.current < 1500) return; // satu kejadian bisa memicu beberapa event
    lastViolationAtRef.current = now;

    violationsRef.current += 1;
    const n = violationsRef.current;
    const isFinal = n >= DISQUALIFY_AFTER;

    const logPromise = callBridge({
      action: 'violation', ...credRef.current,
      answers: buildPayload(answersRef.current), reason, final: isFinal
    }).catch(() => null);

    if (isFinal) {
      finishedRef.current = true;
      clearTimeout(saveTimerRef.current);
      setDqReason(reason);
      if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
      goPhase('dq');
      await logPromise;
    } else {
      warningOpenRef.current = true;
      setWarning({ n, reason });
    }
  }

  async function dismissWarning() {
    await requestFs();
    warningOpenRef.current = false;
    setWarning(null);
  }

  useEffect(() => {
    if (phase !== 'exam') return undefined;
    const fsSupported = typeof document.documentElement.requestFullscreen === 'function';

    const onVis = () => { if (document.hidden) handleViolation('Meninggalkan halaman ujian (pindah tab / minimize)'); };
    const onFs = () => {
      if (REQUIRE_FULLSCREEN && fsSupported && !document.fullscreenElement) handleViolation('Keluar dari mode layar penuh');
    };
    const isField = t => t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT');
    const block = e => e.preventDefault();
    const onCopyCut = e => { if (!isField(e.target)) e.preventDefault(); };
    const onPaste = e => { e.preventDefault(); showToast('Menempel (paste) tidak diizinkan.'); };

    document.addEventListener('visibilitychange', onVis);
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('contextmenu', block);
    document.addEventListener('copy', onCopyCut);
    document.addEventListener('cut', onCopyCut);
    document.addEventListener('paste', onPaste, true);
    document.addEventListener('drop', block);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      document.removeEventListener('fullscreenchange', onFs);
      document.removeEventListener('contextmenu', block);
      document.removeEventListener('copy', onCopyCut);
      document.removeEventListener('cut', onCopyCut);
      document.removeEventListener('paste', onPaste, true);
      document.removeEventListener('drop', block);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  /* =====================  TAMPILAN  ===================== */
  function fmt(s) {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    const mm = String(m).padStart(2, '0'), ss = String(r).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

     if (phase === 'loading') {
    return (
      <Screen center>
        <div className="spinner" />
        <h2 className="title">Memuat ujian...</h2>
        <p className="sub">Mohon tunggu sebentar</p>
      </Screen>
    );
  }

  if (phase === 'error') {
    return (
      <Screen center>
        <div className="icon-badge icon-bad">⚠️</div>
        <h2 className="title">Ujian tidak dapat dibuka</h2>
        <p className="sub" style={{ marginTop: 8 }}>{errMsg}</p>
        <button className="btn btn-ghost" style={{ marginTop: 20 }} onClick={() => window.location.reload()}>
          Muat ulang halaman
        </button>
      </Screen>
    );
  }

  if (phase === 'done') {
    return (
      <Screen center>
        <div className="icon-badge icon-ok">✅</div>
        <h2 className="title">Jawaban terkirim</h2>
        <p className="sub" style={{ marginTop: 8 }}>Terima kasih, jawaban Anda sudah tersimpan. Anda boleh menutup halaman ini.</p>
        {GAS_APP_URL ? <a href={GAS_APP_URL} className="btn btn-primary" style={{ marginTop: 20 }}>Kembali ke aplikasi ujian</a> : null}
      </Screen>
    );
  }

  if (phase === 'dq') {
    return (
      <Screen center>
        <div className="icon-badge icon-bad">⛔</div>
        <h2 className="title" style={{ color: 'var(--danger)' }}>Anda didiskualifikasi</h2>
        <p className="sub" style={{ marginTop: 8 }}>Sistem mendeteksi pelanggaran: <b>{dqReason}</b>.</p>
        <p className="sub" style={{ marginTop: 6 }}>Jawaban yang sudah ada tetap terkirim. Silakan hubungi pengawas ruang.</p>
      </Screen>
    );
  }

  if (phase === 'intro') {
    const answered = data.questions.filter(x => isAnswered(x.id)).length;
    return (
      <Screen>
        <p className="eyebrow">Ujian Online</p>
        <h2 className="title">{data.exam.subject}</h2>
        <p className="sub">{data.student.name} • Kelas {String(data.student.class).toUpperCase()}</p>

        <div className="chips">
          <div className="chip"><b>{data.questions.length}</b><span>Jumlah soal</span></div>
          <div className="chip"><b>{fmt(secondsLeft)}</b><span>Sisa waktu</span></div>
          <div className="chip"><b>{answered}</b><span>Sudah terjawab</span></div>
        </div>

        {answered > 0 && (
          <div className="notice notice-ok">✓ Jawaban sebelumnya ditemukan ({answered} soal). Anda akan melanjutkan.</div>
        )}

        <div className="rules">
          <h4>Perhatikan sebelum mulai</h4>
          <ul>
            <li><span>🚫</span><span>Jangan membuka tab/aplikasi lain atau minimize browser.</span></li>
            <li><span>🖥️</span><span>Jangan keluar dari mode layar penuh.</span></li>
            <li><span>📋</span><span>Menempel (paste) tidak diizinkan.</span></li>
            <li><span>⚠️</span><span>Pelanggaran dicatat dan dapat membuat Anda didiskualifikasi.</span></li>
          </ul>
        </div>

        {introMsg && <div className="notice notice-bad">{introMsg}</div>}
        <button className="btn btn-ok btn-block" style={{ padding: 15 }} onClick={startExam}>
          Saya mengerti &amp; mulai
        </button>
      </Screen>
    );
  }

  const q = data.questions[idx];
  const a = answers[q.id] || { mode: 'text', text: '', photoUrl: '', photoPreview: '', uploading: false, uploadError: '' };
  const answeredCount = data.questions.filter(x => isAnswered(x.id)).length;
  const lowTime = secondsLeft <= 300;
  const shownPhoto = a.photoPreview || a.photoUrl;
  const saveLabel = { saved: '✓ Tersimpan', saving: 'Menyimpan...', unsaved: 'Menyimpan sebentar lagi...', error: '⚠ Belum tersimpan, mencoba lagi' }[saveState];
  const saveColor = saveState === 'error' ? '#fecaca' : 'rgba(255,255,255,0.85)';

  return (
    <>
      <Head>
        <title>{data.exam.subject} | Ujian</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script dangerouslySetInnerHTML={{ __html: "window.MathJax={tex:{inlineMath:[['$','$'],['\\\\(','\\\\)']],displayMath:[['$$','$$'],['\\\\[','\\\\]']]},svg:{fontCache:'global'}};" }} />
        <script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js" async />
      </Head>

      <div style={{ fontFamily: '-apple-system, Segoe UI, Roboto, Arial, sans-serif', background: '#f1f5f9', minHeight: '100vh', userSelect: 'none', WebkitUserSelect: 'none' }}>
        {/* Header */}
        <div style={{ background: '#2b369e', color: '#fff', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, zIndex: 10 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{data.exam.subject}</div>
            <div style={{ fontSize: 12, color: saveColor }}>{data.student.name} • {saveLabel}</div>
          </div>
          <div style={{ background: lowTime ? '#dc2626' : 'rgba(255,255,255,0.15)', borderRadius: 10, padding: '8px 12px', fontWeight: 700, fontFamily: 'monospace', fontSize: 16 }}>
            ⏱ {fmt(secondsLeft)}
          </div>
        </div>

        <div style={{ maxWidth: 760, margin: '0 auto', padding: 16 }}>
          {/* Kartu soal */}
          <div style={{ background: '#fff', borderRadius: 14, padding: 18, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#2563eb', marginBottom: 8 }}>
              SOAL {idx + 1} DARI {data.questions.length} • ESAI
            </div>

            <div style={{ fontSize: 16, lineHeight: 1.6, color: '#0f172a' }} dangerouslySetInnerHTML={{ __html: q.content }} />
            {q.image ? <img src={q.image} alt="Gambar soal" style={{ maxWidth: '100%', marginTop: 10, borderRadius: 8 }} /> : null}

            <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
              {[['text', '⌨️ Ketik Jawaban'], ['photo', '📷 Foto Jawaban']].map(([m, label]) => (
                <button key={m}
                  onClick={() => { updateAnswer(q.id, { mode: m }); setCameraOpen(false); }}
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
                  value={a.text || ''}
                  onChange={e => updateAnswer(q.id, { text: e.target.value })}
                  placeholder="Ketik jawaban Anda di sini..."
                  autoComplete="off" autoCorrect="off" spellCheck={false}
                  style={{ width: '100%', minHeight: 160, boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 12, padding: 12, fontSize: 15, lineHeight: 1.5, fontFamily: 'inherit', resize: 'vertical', userSelect: 'text', WebkitUserSelect: 'text' }}
                />
              ) : (
                <div>
                  {cameraOpen ? (
                    <CameraCapture
                      onUse={photo => { setCameraOpen(false); uploadPhoto(q.id, photo); }}
                      onCancel={() => setCameraOpen(false)}
                    />
                  ) : shownPhoto ? (
                    <div>
                      <img src={shownPhoto} alt="Foto jawaban" style={{ width: '100%', borderRadius: 12, border: '1px solid #e2e8f0' }} />
                      {a.uploading && <p style={{ color: '#2563eb', fontWeight: 600 }}>⏳ Mengunggah foto...</p>}
                      {a.uploadError && (
                        <div style={{ color: '#b91c1c', marginTop: 6 }}>
                          ⚠ {a.uploadError}{' '}
                          <button style={btn('#2563eb')} onClick={() => uploadPhoto(q.id, a.photoPreview)}>Unggah Ulang</button>
                        </div>
                      )}
                      {!a.uploading && (
                        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                          <button style={btn('#2563eb')} onClick={() => setCameraOpen(true)}>Foto Ulang</button>
                          <button style={btn('#dc2626')} onClick={() => updateAnswer(q.id, { photoUrl: '', photoPreview: '', uploadError: '' })}>Hapus Foto</button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <button style={{ ...btn('#2563eb'), width: '100%', padding: 16 }} onClick={() => setCameraOpen(true)}>
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
            <button style={{ ...btn('#2563eb'), flex: 1, opacity: idx === data.questions.length - 1 ? 0.5 : 1 }}
              disabled={idx === data.questions.length - 1} onClick={() => { setIdx(idx + 1); setCameraOpen(false); }}>
              Berikutnya →
            </button>
          </div>

          {/* Kotak nomor soal */}
          <div style={{ background: '#fff', borderRadius: 14, padding: 14, marginTop: 14, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#475569', marginBottom: 8 }}>
              Nomor Soal ({answeredCount}/{data.questions.length} terjawab)
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

          <button onClick={() => setConfirmOpen(true)} disabled={submitting}
            style={{ ...btn('#16a34a'), width: '100%', padding: 14, marginTop: 14, fontSize: 15, opacity: submitting ? 0.6 : 1 }}>
            ✅ Selesai &amp; Kirim Jawaban
          </button>
        </div>

        {/* Konfirmasi kirim */}
        {confirmOpen && (
          <Overlay>
            <h3 style={{ marginTop: 0 }}>Kirim jawaban sekarang?</h3>
            <p style={{ color: '#475569' }}>
              {answeredCount} dari {data.questions.length} soal sudah terjawab.
              {answeredCount < data.questions.length ? ' Ada soal yang belum dijawab.' : ''} Setelah dikirim, jawaban tidak bisa diubah.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button style={{ ...btn('#e2e8f0', '#334155'), flex: 1 }} disabled={submitting} onClick={() => setConfirmOpen(false)}>Kembali</button>
              <button style={{ ...btn('#16a34a'), flex: 1, opacity: submitting ? 0.6 : 1 }} disabled={submitting} onClick={manualSubmit}>
                {submitting ? 'Mengirim...' : 'Ya, Kirim'}
              </button>
            </div>
          </Overlay>
        )}

        {/* Peringatan pelanggaran */}
        {warning && (
          <Overlay>
            <h3 style={{ marginTop: 0, color: '#b91c1c' }}>⚠ Peringatan {warning.n} dari {DISQUALIFY_AFTER}</h3>
            <p style={{ color: '#475569' }}>Terdeteksi: <b>{warning.reason}</b>. Pelanggaran dicatat dan dilaporkan ke pengawas. Jika terjadi lagi sampai batas, Anda akan didiskualifikasi.</p>
            <button style={{ ...btn('#2563eb'), width: '100%' }} onClick={dismissWarning}>Saya mengerti, lanjutkan ujian</button>
          </Overlay>
        )}

        {toast && (
          <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: '#0f172a', color: '#fff', padding: '10px 16px', borderRadius: 10, fontSize: 14, zIndex: 60 }}>
            {toast}
          </div>
        )}
      </div>
    </>
  );
}

function Overlay({ children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 50 }}>
      <div style={{ background: '#fff', borderRadius: 14, padding: 20, maxWidth: 420, width: '100%' }}>{children}</div>
    </div>
  );
}

const BASE_CSS = `
:root{
  --bg:#f4f6fb; --card:#ffffff; --ink:#0f172a; --muted:#64748b; --line:#e2e8f0;
  --primary:#4f46e5; --primary-dark:#4338ca; --primary-soft:#eef2ff;
  --ok:#16a34a; --ok-soft:#f0fdf4; --danger:#dc2626; --danger-soft:#fef2f2;
  --warn:#d97706; --warn-soft:#fffbeb;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:var(--bg);color:var(--ink);font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;-webkit-font-smoothing:antialiased}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:0;border-radius:12px;padding:12px 18px;font:inherit;font-weight:700;font-size:15px;cursor:pointer;transition:transform .08s,box-shadow .15s,background .15s;text-decoration:none}
.btn:active{transform:scale(.98)}
.btn:disabled{opacity:.55;cursor:not-allowed}
.btn-primary{background:var(--primary);color:#fff;box-shadow:0 6px 16px rgba(79,70,229,.25)}
.btn-primary:hover:not(:disabled){background:var(--primary-dark)}
.btn-ok{background:var(--ok);color:#fff;box-shadow:0 6px 16px rgba(22,163,74,.25)}
.btn-ghost{background:#fff;color:#334155;border:1px solid var(--line)}
.btn-danger{background:var(--danger);color:#fff}
.btn-block{width:100%}
.screen{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;background:radial-gradient(1200px 500px at 50% -10%,#e0e7ff 0%,transparent 60%),var(--bg)}
.panel{width:100%;max-width:520px;background:var(--card);border-radius:24px;padding:28px;box-shadow:0 20px 50px rgba(15,23,42,.10);border:1px solid rgba(226,232,240,.8)}
.panel-center{text-align:center}
.icon-badge{width:72px;height:72px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:34px;margin:0 auto 14px}
.icon-ok{background:var(--ok-soft)}
.icon-bad{background:var(--danger-soft)}
.title{margin:0 0 4px;font-size:24px;line-height:1.25;font-weight:800;letter-spacing:-.02em}
.sub{margin:0;color:var(--muted);font-size:14px}
.eyebrow{margin:0 0 6px;font-size:12px;font-weight:700;color:var(--primary);text-transform:uppercase;letter-spacing:.06em}
.chips{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:20px 0}
.chip{background:var(--bg);border-radius:14px;padding:12px 6px;text-align:center}
.chip b{display:block;font-size:18px}
.chip span{font-size:12px;color:var(--muted)}
.notice{border-radius:14px;padding:12px 14px;font-size:14px;margin:0 0 14px}
.notice-ok{background:var(--ok-soft);color:#166534;border:1px solid #bbf7d0}
.notice-bad{background:var(--danger-soft);color:#991b1b;border:1px solid #fecaca}
.rules{background:var(--warn-soft);border:1px solid #fde68a;border-radius:16px;padding:14px 16px;margin:0 0 16px}
.rules h4{margin:0 0 8px;font-size:14px;color:#92400e}
.rules ul{margin:0;padding:0;list-style:none;display:grid;gap:6px}
.rules li{font-size:14px;color:#78350f;display:flex;gap:8px}
.spinner{width:42px;height:42px;border-radius:50%;border:4px solid #e0e7ff;border-top-color:var(--primary);margin:0 auto 14px;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
@media (max-width:480px){.panel{padding:22px;border-radius:20px}.title{font-size:21px}}
`;

function GlobalStyle() {
  return <style dangerouslySetInnerHTML={{ __html: BASE_CSS }} />;
}

function Screen({ children, center }) {
  return (
    <div className="screen">
      <GlobalStyle />
      <div className={'panel' + (center ? ' panel-center' : '')}>{children}</div>
    </div>
  );
}

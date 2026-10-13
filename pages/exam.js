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
    if (Array.isArray(a.choice) ? a.choice.length > 0 : !!a.choice) out[qid] = a.choice;
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
  const [mirror, setMirror] = useState(true);

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
        <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', display: 'block', maxHeight: 420, background: '#000', transform: mirror ? 'scaleX(-1)' : 'none' }} />
      )}

      <div style={{ display: 'flex', gap: 8, padding: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
        {!shot && !err && (
          <>
            {cams.length > 1 && <button style={btn('#475569')} onClick={switchCam}>⟲ Ganti Kamera</button>}
            <button style={btn('#475569')} onClick={() => setMirror(m => !m)}>⇋ Balik</button>
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
    let examID = p.get('examId'), userID = p.get('uid'), token = p.get('token');

    if (examID && userID && token) {
      // Simpan sementara di tab ini, lalu bersihkan alamat di address bar
      try { sessionStorage.setItem('exam_cred', JSON.stringify({ examID, userID, token })); } catch (e) { /* abaikan */ }
      window.history.replaceState(window.history.state, '', window.location.pathname);
    } else {
      // Halaman dimuat ulang (parameter sudah dibersihkan): ambil dari penyimpanan tab
      try {
        const saved = JSON.parse(sessionStorage.getItem('exam_cred') || 'null');
        if (saved) { examID = saved.examID; userID = saved.userID; token = saved.token; }
      } catch (e) { /* abaikan */ }
    }

    if (!examID || !userID || !token) {
      setErrMsg('Link ujian tidak lengkap. Mulai ujian dari aplikasi utama.');
      goPhase('error');
      return;
    }
    credRef.current = { userID, token, examID };

    callBridge({ action: 'start', ...credRef.current })
      .then(res => {
        if (!res.success) { setErrMsg(res.message || 'Gagal memuat ujian.'); goPhase('error'); return; }
        const SUPPORTED = ['Esai', 'PG', 'PG_KOMPLEKS'];
        if (res.questions.some(q => !SUPPORTED.includes(String(q.type).trim()))) {
          setErrMsg('Ujian ini memuat tipe soal yang belum didukung di halaman ini. Hubungi pengawas.');
          goPhase('error');
          return;
        }

        const saved = res.savedAnswers || {};
        const init = {};
        res.questions.forEach(q => {
          const isEsai = String(q.type).trim() === 'Esai';
          const text = isEsai && typeof saved[q.id] === 'string' ? saved[q.id] : '';
          const choice = q.type === 'PG_KOMPLEKS'
            ? (Array.isArray(saved[q.id]) ? saved[q.id] : [])
            : (q.type === 'PG' && typeof saved[q.id] === 'string' ? saved[q.id] : '');
          const photoUrl = typeof saved[q.id + '__photo'] === 'string' ? saved[q.id + '__photo'] : '';
          init[q.id] = { mode: photoUrl && !text ? 'photo' : 'text', text, choice, photoUrl, photoPreview: '', uploading: false, uploadError: '' };
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
          if (!(a.text.trim() || a.photoUrl || (Array.isArray(a.choice) ? a.choice.length : a.choice))) { resume = i; break; }
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
    const cur = answersRef.current[qid] || { mode: 'text', text: '', choice: '', photoUrl: '', photoPreview: '', uploading: false, uploadError: '' };
    answersRef.current = { ...answersRef.current, [qid]: { ...cur, ...patch } };
    setAnswers(answersRef.current);
    if ('text' in patch || 'photoUrl' in patch || 'choice' in patch) {
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
    return !!(a && ((a.text && a.text.trim()) || a.photoUrl || (Array.isArray(a.choice) ? a.choice.length > 0 : a.choice)));
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
  const a = answers[q.id] || { mode: 'text', text: '', choice: '', photoUrl: '', photoPreview: '', uploading: false, uploadError: '' };
  const total = data.questions.length;
  const answeredCount = data.questions.filter(x => isAnswered(x.id)).length;
  const lowTime = secondsLeft <= 300;
  const shownPhoto = a.photoPreview || a.photoUrl;
  const saveLabel = { saved: 'Tersimpan', saving: 'Menyimpan...', unsaved: 'Menunggu simpan', error: 'Gagal simpan, mencoba lagi' }[saveState];
  const goTo = i => { setIdx(i); setCameraOpen(false); };

  return (
    <>
      <Head>
        <title>{data.exam.subject} | Ujian</title>
        <link rel="icon" href="/favicon.png?v=1" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script dangerouslySetInnerHTML={{ __html: "window.MathJax={tex:{inlineMath:[['$','$'],['\\\\(','\\\\)']],displayMath:[['$$','$$'],['\\\\[','\\\\]']]},svg:{fontCache:'global'}};" }} />
        <script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js" async />
      </Head>
      <GlobalStyle />

      <div className="exam-root">
        <header className="topbar">
          <div className="topbar-in">
            <div className="who">
              <div className="avatar">{String(data.student.name || '?').charAt(0).toUpperCase()}</div>
              <div className="who-text">
                <b>{data.exam.subject}</b>
                <span>{data.student.name} • Kelas {String(data.student.class).toUpperCase()}</span>
              </div>
            </div>
            <div className="top-right">
              <span className={'save-pill save-' + saveState}><i /><span>{saveLabel}</span></span>
              <div className={'timer' + (lowTime ? ' timer-low' : '')}>
                <Icon name="clock" size={18} />
                {fmt(secondsLeft)}
              </div>
            </div>
          </div>
          <div className="progress"><div style={{ width: (total ? (answeredCount / total) * 100 : 0) + '%' }} /></div>
        </header>

        <div className="exam-wrap">
          <main>
            <div className="card">
              <div className="q-head">
                <span className="q-num">Soal {idx + 1}</span>
                <span className="q-of">dari {total}</span>
                <span className="q-type">{q.type === 'PG_KOMPLEKS' ? 'PG Kompleks' : q.type === 'PG' ? 'Pilihan Ganda' : 'Esai'}</span>
              </div>

              <div className="q-content" dangerouslySetInnerHTML={{ __html: q.content }} />
              {q.image ? <img className="q-image" src={q.image} alt="Gambar soal" /> : null}

              <div className="divider" />

              {q.type !== 'Esai' ? (
                <Choices q={q} a={a} onChange={v => updateAnswer(q.id, { choice: v })} />
              ) : (
              <>
              <div className="seg">
                {[['text', 'edit', 'Ketik Jawaban'], ['photo', 'camera', 'Foto Jawaban']].map(([m, icon, label]) => (
                  <button key={m} className={'seg-btn' + (a.mode === m ? ' on' : '')}
                    onClick={() => { updateAnswer(q.id, { mode: m }); setCameraOpen(false); }}>
                    <Icon name={icon} size={17} /> {label}
                  </button>
                ))}
              </div>

              {a.mode === 'text' ? (
                <>
                  <textarea
                    className="answer-box"
                    value={a.text || ''}
                    onChange={e => updateAnswer(q.id, { text: e.target.value })}
                    placeholder="Ketik jawaban Anda di sini..."
                    autoComplete="off" autoCorrect="off" spellCheck={false}
                  />
                  <div className="answer-foot">
                    <span>Jawaban tersimpan otomatis</span>
                    <span>{(a.text || '').length} karakter</span>
                  </div>
                </>
              ) : cameraOpen ? (
                <CameraCapture
                  onUse={photo => { setCameraOpen(false); uploadPhoto(q.id, photo); }}
                  onCancel={() => setCameraOpen(false)}
                />
              ) : shownPhoto ? (
                <div>
                  <img className="photo-img" src={shownPhoto} alt="Foto jawaban" />
                  {a.uploading && <p className="photo-state">⏳ Mengunggah foto...</p>}
                  {a.uploadError && (
                    <div className="photo-error">
                      <span>⚠ {a.uploadError}</span>
                      <button className="btn btn-primary" style={{ padding: '8px 14px', fontSize: 14 }} onClick={() => uploadPhoto(q.id, a.photoPreview)}>Unggah Ulang</button>
                    </div>
                  )}
                  {!a.uploading && (
                    <div className="photo-actions">
                      <button className="btn btn-primary" onClick={() => setCameraOpen(true)}><Icon name="camera" /> Foto Ulang</button>
                      <button className="btn btn-danger" onClick={() => updateAnswer(q.id, { photoUrl: '', photoPreview: '', uploadError: '' })}><Icon name="trash" /> Hapus Foto</button>
                    </div>
                  )}
                </div>
              ) : (
                <button className="photo-empty" onClick={() => setCameraOpen(true)}>
                  <Icon name="camera" size={34} />
                  Buka Kamera
                  <small>Foto lembar jawaban Anda dengan jelas dan terang</small>
                </button>
              )}
              </>
              )}
            </div>

            <div className="nav-bar">
              <button className="btn btn-ghost" disabled={idx === 0} onClick={() => goTo(idx - 1)}>
                <Icon name="arrowL" /> Sebelumnya
              </button>
              <button className="btn btn-primary" disabled={idx === total - 1} onClick={() => goTo(idx + 1)}>
                Berikutnya <Icon name="arrowR" />
              </button>
            </div>
          </main>

          <aside className="side card">
            <h3>Navigasi Soal</h3>
            <p className="side-sub">{answeredCount} dari {total} soal terjawab</p>
            <div className="palette">
              {data.questions.map((x, i) => (
                <button key={x.id} onClick={() => goTo(i)}
                  className={'pal-btn' + (isAnswered(x.id) ? ' is-done' : '') + (i === idx ? ' is-current' : '')}>
                  {i + 1}
                </button>
              ))}
            </div>
            <div className="legend">
              <span><i className="c" /> Sekarang</span>
              <span><i className="d" /> Terjawab</span>
              <span><i /> Belum</span>
            </div>
            <button className="btn btn-ok btn-block" onClick={() => setConfirmOpen(true)} disabled={submitting}>
              <Icon name="send" /> Selesai &amp; Kirim
            </button>
          </aside>
        </div>

        {confirmOpen && (
          <Overlay>
            <h3 className="modal-title">Kirim jawaban sekarang?</h3>
            <p className="modal-text">
              {answeredCount} dari {total} soal sudah terjawab.
              {answeredCount < total ? ' Ada soal yang belum dijawab.' : ''} Setelah dikirim, jawaban tidak bisa diubah.
            </p>
            <div className="modal-actions">
              <button className="btn btn-ghost" disabled={submitting} onClick={() => setConfirmOpen(false)}>Kembali</button>
              <button className="btn btn-ok" disabled={submitting} onClick={manualSubmit}>
                {submitting ? 'Mengirim...' : 'Ya, Kirim'}
              </button>
            </div>
          </Overlay>
        )}

        {warning && (
          <Overlay>
            <div className="icon-badge icon-warn">⚠️</div>
            <h3 className="modal-title" style={{ textAlign: 'center', color: 'var(--danger)' }}>Peringatan {warning.n} dari {DISQUALIFY_AFTER}</h3>
            <p className="modal-text" style={{ textAlign: 'center' }}>
              Terdeteksi: <b>{warning.reason}</b>. Pelanggaran dicatat dan dilaporkan ke pengawas. Jika terjadi lagi sampai batas, Anda akan didiskualifikasi.
            </p>
            <button className="btn btn-primary btn-block" onClick={dismissWarning}>Saya mengerti, lanjutkan ujian</button>
          </Overlay>
        )}

        {toast && <div className="toast">{toast}</div>}
      </div>
    </>
  );
}

function Choices({ q, a, onChange }) {
  const multi = q.type === 'PG_KOMPLEKS';
  const opts = Array.isArray(q.options) ? q.options : [];
  const sel = multi ? (Array.isArray(a.choice) ? a.choice : []) : a.choice;

  function pick(o) {
    if (multi) onChange(sel.includes(o) ? sel.filter(x => x !== o) : [...sel, o]);
    else onChange(sel === o ? '' : o);
  }

  return (
    <div className="choices">
      <p className="choice-hint">{multi ? 'Pilih satu atau lebih jawaban yang benar.' : 'Pilih satu jawaban yang paling tepat.'}</p>
      {opts.map((o, i) => {
        const on = multi ? sel.includes(o) : sel === o;
        return (
          <button key={i} type="button" className={'choice' + (on ? ' on' : '') + (multi ? ' multi' : '')} onClick={() => pick(o)}>
            <span className="choice-mark">{String.fromCharCode(65 + i)}</span>
            <span className="choice-text" dangerouslySetInnerHTML={{ __html: String(o) }} />
          </button>
        );
      })}
    </div>
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
.exam-root{min-height:100vh;user-select:none;-webkit-user-select:none}
.topbar{position:sticky;top:0;z-index:30;background:rgba(255,255,255,.88);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.topbar-in{max-width:1100px;margin:0 auto;padding:10px 20px;display:flex;align-items:center;justify-content:space-between;gap:12px}
.who{display:flex;align-items:center;gap:12px;min-width:0}
.avatar{width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,#6366f1,#4338ca);color:#fff;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.who-text{min-width:0}
.who-text b{display:block;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.who-text span{font-size:12px;color:var(--muted)}
.top-right{display:flex;align-items:center;gap:10px;flex-shrink:0}
.save-pill{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;padding:6px 10px;border-radius:999px;background:var(--bg);color:var(--muted)}
.save-pill i{width:8px;height:8px;border-radius:50%;background:#94a3b8}
.save-saved{color:#166534;background:var(--ok-soft)}
.save-saved i{background:var(--ok)}
.save-saving i,.save-unsaved i{background:var(--warn)}
.save-saving i{animation:pulse 1s ease-in-out infinite}
.save-error{color:#991b1b;background:var(--danger-soft)}
.save-error i{background:var(--danger)}
.timer{display:inline-flex;align-items:center;gap:8px;padding:8px 14px;border-radius:12px;background:var(--primary-soft);color:var(--primary-dark);font-weight:800;font-size:16px;font-variant-numeric:tabular-nums}
.timer-low{background:var(--danger);color:#fff;animation:pulse 1s ease-in-out infinite}
@keyframes pulse{50%{opacity:.55}}
.progress{height:4px;background:var(--line)}
.progress>div{height:100%;background:linear-gradient(90deg,#6366f1,#16a34a);transition:width .3s}
.exam-wrap{max-width:1100px;margin:0 auto;padding:20px;display:grid;gap:20px;grid-template-columns:minmax(0,1fr) 300px;align-items:start}
.card{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:22px;box-shadow:0 4px 20px rgba(15,23,42,.05)}
.q-head{display:flex;align-items:center;gap:10px;margin-bottom:14px}
.q-num{background:var(--primary);color:#fff;font-weight:800;border-radius:12px;padding:6px 14px;font-size:15px}
.q-of{font-size:13px;color:var(--muted);font-weight:600}
.q-type{margin-left:auto;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--primary);background:var(--primary-soft);padding:5px 10px;border-radius:999px}
.q-content{font-size:17px;line-height:1.75}
.q-content p{margin:0 0 .8em}
.q-content img,.q-image{max-width:100%;border-radius:12px;margin-top:10px}
.divider{height:1px;background:var(--line);margin:20px 0}
.seg{display:grid;grid-template-columns:1fr 1fr;gap:6px;background:var(--bg);padding:5px;border-radius:14px;margin-bottom:14px}
.seg-btn{display:flex;align-items:center;justify-content:center;gap:8px;border:0;background:transparent;padding:11px 8px;border-radius:10px;font:inherit;font-weight:700;font-size:14px;color:var(--muted);cursor:pointer}
.seg-btn.on{background:#fff;color:var(--primary-dark);box-shadow:0 2px 8px rgba(15,23,42,.10)}
.answer-box{width:100%;min-height:200px;border:1.5px solid var(--line);border-radius:14px;padding:14px;font:inherit;font-size:16px;line-height:1.6;resize:vertical;user-select:text;-webkit-user-select:text;outline:none;background:#fff}
.answer-box:focus{border-color:var(--primary);box-shadow:0 0 0 4px rgba(79,70,229,.12)}
.answer-foot{display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-top:8px}
.photo-empty{width:100%;display:flex;flex-direction:column;align-items:center;gap:8px;padding:34px 16px;border:2px dashed #c7d2fe;background:var(--primary-soft);border-radius:16px;color:var(--primary-dark);font:inherit;font-weight:700;cursor:pointer}
.photo-empty small{font-weight:500;color:var(--muted)}
.photo-img{width:100%;border-radius:14px;border:1px solid var(--line);display:block}
.photo-actions{display:flex;gap:10px;margin-top:10px;flex-wrap:wrap}
.photo-state{margin-top:10px;font-size:14px;font-weight:600;color:var(--primary-dark)}
.photo-error{margin-top:10px;font-size:14px;color:#991b1b;background:var(--danger-soft);border:1px solid #fecaca;border-radius:12px;padding:10px 12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.nav-bar{display:flex;gap:12px;margin-top:16px}
.nav-bar .btn{flex:1}
.side{position:sticky;top:84px}
.side h3{margin:0 0 4px;font-size:15px}
.side-sub{font-size:13px;color:var(--muted);margin:0 0 14px}
.palette{display:grid;grid-template-columns:repeat(auto-fill,minmax(44px,1fr));gap:8px}
.pal-btn{height:44px;border-radius:12px;border:1.5px solid var(--line);background:#fff;font:inherit;font-weight:700;color:#334155;cursor:pointer}
.pal-btn.is-done{background:var(--ok);border-color:var(--ok);color:#fff}
.pal-btn.is-current{border-color:var(--primary);box-shadow:0 0 0 3px rgba(79,70,229,.25)}
.legend{display:flex;gap:14px;flex-wrap:wrap;margin:14px 0 18px;font-size:12px;color:var(--muted)}
.legend span{display:inline-flex;align-items:center;gap:6px}
.legend i{width:12px;height:12px;border-radius:4px;border:1.5px solid var(--line);display:inline-block}
.legend .d{background:var(--ok);border-color:var(--ok)}
.legend .c{border-color:var(--primary)}
.overlay{position:fixed;inset:0;background:rgba(15,23,42,.6);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:20px;z-index:50}
.modal{background:#fff;border-radius:22px;padding:26px;max-width:440px;width:100%;box-shadow:0 30px 60px rgba(15,23,42,.35)}
.modal-title{margin:0 0 8px;font-size:20px;font-weight:800}
.modal-text{margin:0 0 20px;color:var(--muted);font-size:15px;line-height:1.55}
.modal-actions{display:flex;gap:10px}
.modal-actions .btn{flex:1}
.icon-warn{background:var(--warn-soft)}
.choices{display:grid;gap:10px}
.choice-hint{margin:0 0 2px;font-size:13px;font-weight:600;color:var(--muted)}
.choice{display:flex;align-items:center;gap:14px;width:100%;text-align:left;padding:13px 14px;border:1.5px solid var(--line);border-radius:14px;background:#fff;font:inherit;font-size:16px;line-height:1.5;color:var(--ink);cursor:pointer;transition:border-color .15s,background .15s,box-shadow .15s}
.choice:hover{border-color:#c7d2fe;background:#fafaff}
.choice-mark{flex-shrink:0;width:34px;height:34px;border-radius:50%;border:1.5px solid var(--line);background:var(--bg);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;color:var(--muted)}
.choice.multi .choice-mark{border-radius:10px}
.choice-text{flex:1;min-width:0}
.choice-text p{margin:0}
.choice-text img{max-width:100%;border-radius:8px}
.choice.on{border-color:var(--primary);background:var(--primary-soft);box-shadow:0 0 0 3px rgba(79,70,229,.12)}
.choice.on .choice-mark{background:var(--primary);border-color:var(--primary);color:#fff}
.toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--ink);color:#fff;padding:12px 18px;border-radius:12px;font-size:14px;z-index:60;max-width:90vw;box-shadow:0 10px 30px rgba(15,23,42,.3)}
@media (max-width:899px){
  .exam-wrap{grid-template-columns:1fr;padding:14px 14px 100px}
  .side{position:static}
  .nav-bar{position:fixed;left:0;right:0;bottom:0;margin:0;padding:12px 14px calc(12px + env(safe-area-inset-bottom));background:rgba(255,255,255,.94);backdrop-filter:blur(10px);border-top:1px solid var(--line);z-index:30}
  .toast{bottom:90px}
}
@media (max-width:560px){
  .topbar-in{padding:8px 12px}
  .save-pill span{display:none}
  .timer{padding:7px 10px;font-size:15px}
  .card{padding:16px;border-radius:16px}
  .q-content{font-size:16px}
  .avatar{width:36px;height:36px}
}
`;

function GlobalStyle() {
  return <style dangerouslySetInnerHTML={{ __html: BASE_CSS }} />;
}

function Screen({ children, center }) {
  return (
    <div className="screen">
      <SiteHead />
      <GlobalStyle />
      <div className={'panel' + (center ? ' panel-center' : '')}>{children}</div>
    </div>
  );
}

function SiteHead() {
  return (
    <Head>
      <title>Ujian Online</title>
      <link rel="icon" href="/favicon.png?v=1" />
    </Head>
  );
}

const ICONS = {
  clock: <><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>,
  edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></>,
  camera: <><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></>,
  arrowL: <><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></>,
  arrowR: <><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></>,
  send: <><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></>,
  trash: <><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></>
};

function Icon({ name, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

// Jembatan Vercel -> Apps Script.
// Browser siswa memanggil /api/bridge, lalu file ini meneruskan ke Apps Script
// dengan menambahkan GAS_BRIDGE_SECRET (rahasia, hanya ada di server Vercel).

export const config = { api: { bodyParser: { sizeLimit: '3mb' } } };

const ALLOWED_ACTIONS = ['start', 'save', 'photo', 'submit', 'violation'];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method tidak diizinkan.' });
  }

  const url = process.env.GAS_BRIDGE_URL;
  const secret = process.env.GAS_BRIDGE_SECRET;
  if (!url || !secret) {
    return res.status(500).json({
      success: false,
      message: 'GAS_BRIDGE_URL atau GAS_BRIDGE_SECRET belum diisi di Vercel (Settings > Environment Variables), lalu Redeploy.'
    });
  }

  const b = req.body || {};
  if (!ALLOWED_ACTIONS.includes(b.action)) {
    return res.status(400).json({ success: false, message: 'Aksi tidak dikenal.' });
  }

  const payload = {
    secret,
    action: b.action,
    userID: b.userID,
    token: b.token,
    examID: b.examID,
    answers: b.answers,
    qid: b.qid,
    dataUrl: b.dataUrl,
    reason: b.reason,
    final: b.final
  };

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow'
    });
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return res.status(502).json({
        success: false,
        message: 'Balasan Apps Script tidak terbaca. Pastikan GAS_BRIDGE_URL adalah URL "/exec" dan Apps Script sudah di-deploy ulang (New version).'
      });
    }
    return res.status(200).json(data);
  } catch (err) {
    return res.status(502).json({ success: false, message: 'Gagal menghubungi Apps Script: ' + err.message });
  }
}

// Tahap 3a: validasi sesi siswa (cocokkan ke sheet Users) lalu ambil data ujian + daftar soal.
// Dipanggil seperti: /api/start-exam?examId=EXM-XXX&uid=XXXXXX&token=XXXXXX

import { google } from 'googleapis';

function normId(v) {
  const s = String(v || '').trim();
  return /^\d+$/.test(s) ? String(parseInt(s, 10)) : s;
}

async function getSheetsClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const auth = new google.auth.JWT(email, null, privateKey, ['https://www.googleapis.com/auth/spreadsheets']);
  return google.sheets({ version: 'v4', auth });
}

export default async function handler(req, res) {
  try {
    const { examId, uid, token } = req.query;
    if (!examId || !uid || !token) {
      return res.status(400).json({ success: false, message: 'Parameter examId, uid, dan token wajib ada di URL.' });
    }

    const sheetId = process.env.GOOGLE_SHEET_ID;
    const sheets = await getSheetsClient();

    // 1. Validasi sesi siswa dari sheet Users
    const uResp = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: 'Users!A:F' });
    const uRows = uResp.data.values || [];
    let student = null;
    for (let i = 1; i < uRows.length; i++) {
      const row = uRows[i];
      if (normId(row[0]) === normId(uid) && String(row[5] || '') === String(token) && String(row[3] || '').trim() === 'Siswa') {
        student = { userId: String(row[0]), name: row[1], class: String(row[4] || '').trim() };
        break;
      }
    }
    if (!student) {
      return res.status(401).json({ success: false, message: 'Sesi tidak valid atau sudah habis. Silakan login ulang dari aplikasi utama.' });
    }

    // 2. Ambil data ujian dari sheet Exams
    const eResp = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: 'Exams!A:J' });
    const eRows = eResp.data.values || [];
    let exam = null;
    for (let i = 1; i < eRows.length; i++) {
      const row = eRows[i];
      if (String(row[0]) === String(examId)) {
        exam = {
          id: row[0], subject: row[1], class: row[2],
          startDate: row[3] || '', durationMinutes: parseFloat(row[4]) || 60,
          status: row[6] || '', endDate: row[7] || ''
        };
        break;
      }
    }
    if (!exam) {
      return res.status(404).json({ success: false, message: 'Ujian tidak ditemukan.' });
    }

    // Cek siswa ini memang kelasnya cocok dengan ujian ini
    const examClasses = String(exam.class || '').toLowerCase().split(',').map(c => c.trim());
    if (!examClasses.includes(student.class.toLowerCase())) {
      return res.status(403).json({ success: false, message: 'Ujian ini bukan untuk kelas Anda.' });
    }

    // 3. Ambil soal dari sheet Questions, hanya milik ujian ini
    const qResp = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: 'Questions!A:I' });
    const qRows = qResp.data.values || [];
    const questions = [];
    for (let i = 1; i < qRows.length; i++) {
      const row = qRows[i];
      if (String(row[1]) !== String(examId)) continue;
      let options = [];
      try { options = JSON.parse(row[5] || '[]'); } catch (e) {}
      questions.push({
        id: row[0],
        type: row[2],
        content: row[3] || '',
        image: row[4] || '',
        options: options,
        isRequired: row[7] || 'FALSE',
        point: parseFloat(row[8]) || 10
        // Catatan: kolom "CorrectAnswer"/kunci sengaja TIDAK disertakan di sini untuk soal
        // pilihan ganda dkk, supaya tidak bocor ke sisi siswa (beda dari aplikasi GAS lama
        // yang mengirim semuanya). Nanti dicocokkan di server saat submit (Tahap 3d).
      });
    }

    return res.status(200).json({
      success: true,
      student,
      exam,
      totalSoal: questions.length,
      questions
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Terjadi kesalahan di server.' });
  }
}

// API test: baca sheet 'Exams' dari Spreadsheet ujian kamu, pakai Service Account.
// Kalau ini berhasil mengembalikan data, berarti koneksi Vercel -> Google Sheets sudah benar.

import { google } from 'googleapis';

export default async function handler(req, res) {
  try {
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
    const sheetId = process.env.GOOGLE_SHEET_ID;

    if (!email || !privateKey || !sheetId) {
      return res.status(500).json({
        success: false,
        message: 'Environment variable belum lengkap. Pastikan GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, dan GOOGLE_SHEET_ID sudah diisi di Vercel.'
      });
    }

    const auth = new google.auth.JWT(
      email,
      null,
      privateKey,
      ['https://www.googleapis.com/auth/spreadsheets.readonly']
    );

    const sheets = google.sheets({ version: 'v4', auth });
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Exams!A:C' // kolom ID, Mapel, Kelas - sesuai sheet Exams di aplikasi kamu
    });

    const rows = result.data.values || [];
    const header = rows[0] || [];
    const data = rows.slice(1).map(r => ({
      id: r[0] || '',
      subject: r[1] || '',
      class: r[2] || ''
    }));

    return res.status(200).json({ success: true, header, totalUjian: data.length, data });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || 'Gagal mengambil data dari Google Sheets.'
    });
  }
}

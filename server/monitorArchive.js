/**
 * Lưu trữ dài hạn sự kiện Giám sát Tạm nhập – Tái xuất.
 * Bảng live fms_temp_import_exports có thể bị dọn / self-heal;
 * fms_monitor_events giữ vĩnh viễn để thống kê tháng & xuất DOCX.
 */
const { getDb } = require('./db');

const TYPE_LABELS = {
  CANCELLED_FUELED: 'Cancel → Tái xuất',
  DOMESTIC_TO_INTL: 'Nội địa → Quốc tế',
  INTL_TO_DOMESTIC: 'Quốc tế → Nội địa',
  TECHNICAL_HAN: 'Nạp kỹ thuật HAN-HAN'
};

const STATUS_LABELS = {
  OPEN: 'Đang theo dõi',
  WARNED: 'Đã phát hiện chặng mới / đã cảnh báo',
  CLOSED_SAFE: 'Đóng an toàn (chặng ND / không tái xuất)',
  RESOLVED: 'Đã xử lý (xác nhận thủ công)',
  EXPIRED: 'Hết hạn cửa sổ theo dõi',
  DELETED: 'Đã xóa khỏi live',
  LOST: 'Mất bản ghi live (không rõ nguyên nhân)'
};

function typeLabel(t) {
  return TYPE_LABELS[t] || t || '-';
}

function statusLabel(s) {
  return STATUS_LABELS[s] || s || '-';
}

function buildReason(monitorType, row = {}) {
  const ac = row.ac_reg || '-';
  const flt = row.old_flight_no || '-';
  const route = row.old_route || '-';
  const kg = Number(row.fuel_order || 0);
  const t = row.old_time || '-';
  if (monitorType === 'CANCELLED_FUELED') {
    return `Chuyến ${flt} (${route}) đã nạp ${kg.toLocaleString('vi-VN')} kg trên tàu ${ac} lúc ${t} — mất trên FMS VNA (Cancel). Theo dõi tái xuất QT.`;
  }
  if (monitorType === 'DOMESTIC_TO_INTL') {
    return `Tàu ${ac} nạp ND ${flt} (${route}, ${kg.toLocaleString('vi-VN')} kg lúc ${t}) rồi đổi tàu — bám có bay QT không.`;
  }
  if (monitorType === 'INTL_TO_DOMESTIC') {
    return `Tàu ${ac} nạp QT ${flt} (${route}, ${kg.toLocaleString('vi-VN')} kg lúc ${t}) rồi đổi tàu — bám có bay ND không.`;
  }
  if (monitorType === 'TECHNICAL_HAN') {
    return `Tàu ${ac} nạp kỹ thuật HAN-HAN ${kg.toLocaleString('vi-VN')} kg (${flt} lúc ${t}) — bám chặng bay tiếp theo.`;
  }
  return `Sự kiện ${monitorType} — tàu ${ac} / ${flt}`;
}

function eventKey(row) {
  const ac = String(row.ac_reg || '').toUpperCase().replace(/\s+/g, '');
  const flt = String(row.old_flight_no || '').toUpperCase().replace(/\s+/g, '');
  const d = String(row.date || row.event_date || '');
  const t = String(row.monitor_type || '');
  return `${ac}|${flt}|${d}|${t}`;
}

/**
 * Tạo / cập nhật bản ghi lịch sử khi có sự kiện live.
 * status: OPEN | WARNED | CLOSED_SAFE | RESOLVED | EXPIRED | DELETED
 */
async function upsertMonitorEvent(db, payload) {
  try {
    const key = payload.event_key || eventKey(payload);
    const existing = await db.get(
      'SELECT id, status, new_flight_no, new_route FROM fms_monitor_events WHERE event_key = ?',
      key
    );

    const reason = payload.reason || buildReason(payload.monitor_type, payload);
    const now = new Date().toISOString();

    if (!existing) {
      await db.run(
        `INSERT INTO fms_monitor_events (
          event_key, ac_reg, monitor_type, event_date,
          old_flight_no, old_route, old_time, fuel_order, reason,
          status, new_flight_no, new_route, resolved_at, resolved_note,
          zalo_sent, source_monitor_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        key,
        payload.ac_reg || '',
        payload.monitor_type || '',
        payload.event_date || payload.date || '',
        payload.old_flight_no || '',
        payload.old_route || '',
        payload.old_time || '-',
        parseInt(payload.fuel_order, 10) || 0,
        reason,
        payload.status || 'OPEN',
        payload.new_flight_no || null,
        payload.new_route || null,
        payload.resolved_at || null,
        payload.resolved_note || null,
        payload.zalo_sent ? 1 : 0,
        payload.source_monitor_id || null
      );
      return { created: true, event_key: key };
    }

    // Merge: không hạ cấp WARNED/RESOLVED về OPEN trừ khi forceStatus
    const statusOrder = { OPEN: 0, WARNED: 1, CLOSED_SAFE: 2, RESOLVED: 3, EXPIRED: 2, DELETED: 2, LOST: 2 };
    const curS = existing.status || 'OPEN';
    const nextS = payload.status || curS;
    const keepStatus = payload.forceStatus
      ? nextS
      : ((statusOrder[nextS] ?? 0) >= (statusOrder[curS] ?? 0) ? nextS : curS);

    await db.run(
      `UPDATE fms_monitor_events SET
        ac_reg = COALESCE(?, ac_reg),
        old_route = COALESCE(?, old_route),
        old_time = COALESCE(?, old_time),
        fuel_order = CASE WHEN ? > 0 THEN ? ELSE fuel_order END,
        reason = CASE WHEN reason IS NULL OR reason = '' THEN ? ELSE reason END,
        status = ?,
        new_flight_no = COALESCE(?, new_flight_no),
        new_route = COALESCE(?, new_route),
        resolved_at = COALESCE(?, resolved_at),
        resolved_note = COALESCE(?, resolved_note),
        zalo_sent = CASE WHEN ? = 1 THEN 1 ELSE zalo_sent END,
        source_monitor_id = COALESCE(?, source_monitor_id),
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      payload.ac_reg || null,
      payload.old_route || null,
      payload.old_time || null,
      parseInt(payload.fuel_order, 10) || 0,
      parseInt(payload.fuel_order, 10) || 0,
      reason,
      keepStatus,
      payload.new_flight_no || null,
      payload.new_route || null,
      payload.resolved_at || null,
      payload.resolved_note || null,
      payload.zalo_sent ? 1 : 0,
      payload.source_monitor_id || null,
      existing.id
    );
    return { created: false, event_key: key, id: existing.id };
  } catch (err) {
    console.error('[MonitorArchive] upsert:', err.message);
    return { error: err.message };
  }
}

async function archiveFromLiveRow(db, row, status, extra = {}) {
  if (!row) return;
  return upsertMonitorEvent(db, {
    ac_reg: row.ac_reg,
    monitor_type: row.monitor_type,
    event_date: row.date,
    date: row.date,
    old_flight_no: row.old_flight_no,
    old_route: row.old_route,
    old_time: row.old_time,
    fuel_order: row.fuel_order,
    new_flight_no: row.new_flight_no || extra.new_flight_no,
    new_route: row.new_route || extra.new_route,
    status,
    zalo_sent: extra.zalo_sent || (status === 'WARNED' ? 1 : 0),
    source_monitor_id: row.id,
    resolved_at: extra.resolved_at || (['RESOLVED', 'CLOSED_SAFE', 'EXPIRED', 'DELETED'].includes(status) ? new Date().toISOString() : null),
    resolved_note: extra.resolved_note || null,
    reason: extra.reason,
    forceStatus: !!extra.forceStatus
  });
}

async function listMonitorEvents(db, { from, to, status, monitor_type, q } = {}) {
  const clauses = ['1=1'];
  const params = [];
  if (from) {
    clauses.push('event_date >= ?');
    params.push(from);
  }
  if (to) {
    clauses.push('event_date <= ?');
    params.push(to);
  }
  if (status && status !== 'all') {
    clauses.push('status = ?');
    params.push(status);
  }
  if (monitor_type && monitor_type !== 'all') {
    clauses.push('monitor_type = ?');
    params.push(monitor_type);
  }
  if (q) {
    clauses.push(
      `(UPPER(ac_reg) LIKE ? OR UPPER(old_flight_no) LIKE ? OR UPPER(COALESCE(new_flight_no,'')) LIKE ? OR reason LIKE ?)`
    );
    const like = `%${String(q).toUpperCase()}%`;
    params.push(like, like, like, `%${q}%`);
  }
  const rows = await db.all(
    `SELECT * FROM fms_monitor_events
     WHERE ${clauses.join(' AND ')}
     ORDER BY event_date DESC, id DESC
     LIMIT 2000`,
    ...params
  );
  return rows || [];
}

async function summarizeEvents(rows) {
  const byType = {};
  const byStatus = {};
  for (const r of rows || []) {
    byType[r.monitor_type] = (byType[r.monitor_type] || 0) + 1;
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  }
  return { total: (rows || []).length, byType, byStatus };
}

/**
 * Xuất DOCX báo cáo chuyên nghiệp.
 * @returns {Promise<Buffer>}
 */
async function buildMonitorEventsDocx(rows, meta = {}) {
  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    WidthType, AlignmentType, BorderStyle, HeadingLevel, ShadingType
  } = require('docx');

  const from = meta.from || '-';
  const to = meta.to || '-';
  const summary = await summarizeEvents(rows);
  const nowStr = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

  const border = { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' };
  const borders = { top: border, bottom: border, left: border, right: border };
  const headerShading = { type: ShadingType.CLEAR, fill: '0F766E' };
  const altShading = { type: ShadingType.CLEAR, fill: 'F0FDFA' };

  const cell = (text, opts = {}) =>
    new TableCell({
      borders,
      width: { size: opts.w || 1200, type: WidthType.DXA },
      shading: opts.shading,
      margins: { top: 40, bottom: 40, left: 60, right: 60 },
      children: [
        new Paragraph({
          children: [
            new TextRun({
              text: String(text ?? '-'),
              bold: !!opts.bold,
              color: opts.color || (opts.bold ? 'FFFFFF' : '0F172A'),
              size: opts.size || 16,
              font: 'Calibri'
            })
          ]
        })
      ]
    });

  const headerRow = new TableRow({
    children: [
      cell('STT', { bold: true, w: 500, shading: headerShading }),
      cell('Ngày SK', { bold: true, w: 1100, shading: headerShading }),
      cell('Loại', { bold: true, w: 1600, shading: headerShading }),
      cell('Tàu', { bold: true, w: 1000, shading: headerShading }),
      cell('Chuyến nạp', { bold: true, w: 1200, shading: headerShading }),
      cell('Chặng / kg', { bold: true, w: 1600, shading: headerShading }),
      cell('Chặng mới', { bold: true, w: 1400, shading: headerShading }),
      cell('Trạng thái', { bold: true, w: 1600, shading: headerShading }),
      cell('Nguyên nhân / sự kiện', { bold: true, w: 3200, shading: headerShading })
    ]
  });

  const dataRows = (rows || []).map((r, i) => {
    const shade = i % 2 === 1 ? altShading : undefined;
    const kg = Number(r.fuel_order || 0).toLocaleString('vi-VN');
    const next =
      r.new_flight_no
        ? `${r.new_flight_no}${r.new_route ? ` (${r.new_route})` : ''}`
        : '—';
    return new TableRow({
      children: [
        cell(String(i + 1), { w: 500, shading: shade }),
        cell(r.event_date || '-', { w: 1100, shading: shade }),
        cell(typeLabel(r.monitor_type), { w: 1600, shading: shade }),
        cell(r.ac_reg || '-', { w: 1000, shading: shade }),
        cell(`${r.old_flight_no || '-'}`, { w: 1200, shading: shade }),
        cell(`${r.old_route || '-'} / ${kg} kg`, { w: 1600, shading: shade }),
        cell(next, { w: 1400, shading: shade }),
        cell(statusLabel(r.status), { w: 1600, shading: shade }),
        cell(r.reason || buildReason(r.monitor_type, r), { w: 3200, shading: shade, size: 14 })
      ]
    });
  });

  const typeLines = Object.entries(summary.byType).map(
    ([k, n]) => `${typeLabel(k)}: ${n}`
  );
  const statusLines = Object.entries(summary.byStatus).map(
    ([k, n]) => `${statusLabel(k)}: ${n}`
  );

  const doc = new Document({
    creator: 'SkyEyes FMS',
    title: `Báo cáo Giám sát Tạm nhập - Tái xuất ${from} → ${to}`,
    description: 'Thống kê sự kiện Cancel / đổi tàu / NKT / tái xuất',
    sections: [
      {
        properties: {
          page: {
            margin: { top: 720, bottom: 720, left: 720, right: 720 }
          }
        },
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            spacing: { after: 120 },
            children: [
              new TextRun({
                text: 'BÁO CÁO GIÁM SÁT TẠM NHẬP – TÁI XUẤT TÀU BAY',
                bold: true,
                color: '0F766E',
                size: 32,
                font: 'Calibri'
              })
            ]
          }),
          new Paragraph({
            spacing: { after: 80 },
            children: [
              new TextRun({
                text: 'Hệ thống SkyEyes / FMS Skypec · Vietnam Airlines ground fuel ops',
                italics: true,
                color: '64748B',
                size: 18,
                font: 'Calibri'
              })
            ]
          }),
          new Paragraph({
            spacing: { after: 60 },
            children: [
              new TextRun({ text: 'Kỳ báo cáo: ', bold: true, size: 20, font: 'Calibri' }),
              new TextRun({ text: `${from}  →  ${to}`, size: 20, font: 'Calibri' })
            ]
          }),
          new Paragraph({
            spacing: { after: 60 },
            children: [
              new TextRun({ text: 'Xuất lúc: ', bold: true, size: 20, font: 'Calibri' }),
              new TextRun({ text: nowStr, size: 20, font: 'Calibri' })
            ]
          }),
          new Paragraph({
            spacing: { after: 60 },
            children: [
              new TextRun({ text: 'Tổng sự kiện: ', bold: true, size: 20, font: 'Calibri' }),
              new TextRun({ text: String(summary.total), size: 20, font: 'Calibri', bold: true, color: '0F766E' })
            ]
          }),
          new Paragraph({
            spacing: { before: 160, after: 80 },
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun({ text: '1. Tóm tắt theo loại sự kiện', bold: true, size: 24, color: '0F766E', font: 'Calibri' })]
          }),
          ...(typeLines.length
            ? typeLines.map(
                (t) =>
                  new Paragraph({
                    bullet: { level: 0 },
                    children: [new TextRun({ text: t, size: 19, font: 'Calibri' })]
                  })
              )
            : [
                new Paragraph({
                  children: [new TextRun({ text: 'Không có dữ liệu trong kỳ.', size: 19, font: 'Calibri', italics: true })]
                })
              ]),
          new Paragraph({
            spacing: { before: 160, after: 80 },
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun({ text: '2. Tóm tắt theo trạng thái xử lý', bold: true, size: 24, color: '0F766E', font: 'Calibri' })]
          }),
          ...(statusLines.length
            ? statusLines.map(
                (t) =>
                  new Paragraph({
                    bullet: { level: 0 },
                    children: [new TextRun({ text: t, size: 19, font: 'Calibri' })]
                  })
              )
            : [
                new Paragraph({
                  children: [new TextRun({ text: '—', size: 19, font: 'Calibri' })]
                })
              ]),
          new Paragraph({
            spacing: { before: 200, after: 120 },
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun({ text: '3. Chi tiết sự kiện', bold: true, size: 24, color: '0F766E', font: 'Calibri' })]
          }),
          new Table({
            width: { size: 10080, type: WidthType.DXA },
            rows: [headerRow, ...dataRows]
          }),
          new Paragraph({
            spacing: { before: 280 },
            children: [
              new TextRun({
                text: 'Ghi chú: Dữ liệu lấy từ kho lưu dài hạn fms_monitor_events (không phụ thuộc bảng live có thể bị dọn). Cancel = nạp kg>0 + mất FMS VNA; Tái xuất QT = tàu sau đó bay chặng quốc tế đi từ HAN.',
                size: 16,
                italics: true,
                color: '64748B',
                font: 'Calibri'
              })
            ]
          }),
          new Paragraph({
            spacing: { before: 200 },
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({
                text: '— SkyEyes FMS · Báo cáo tự động —',
                size: 16,
                color: '94A3B8',
                font: 'Calibri'
              })
            ]
          })
        ]
      }
    ]
  });

  return Packer.toBuffer(doc);
}

module.exports = {
  TYPE_LABELS,
  STATUS_LABELS,
  typeLabel,
  statusLabel,
  buildReason,
  eventKey,
  upsertMonitorEvent,
  archiveFromLiveRow,
  listMonitorEvents,
  summarizeEvents,
  buildMonitorEventsDocx
};

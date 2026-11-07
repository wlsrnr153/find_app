/**
 * 자산대장 vs 물품상태분류내역서를 순번으로 비교해 차이 엑셀을 만든다.
 *   node scripts/compare-register-by-seq.js
 */
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const desktop = path.join(process.env.USERPROFILE, 'Desktop');
const registerPath = path.join(desktop, '전북대학교 산학협력단 자산대장_2026_10_16(변동사항, 내용연수 반영).xlsx');
const statusPath = path.join(desktop, '붙임2. (최종,공유)붙임1.물품상태분류내역서_산단.xlsx');

function cellText(value) {
    if (value == null) return '';
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) return '';
        const y = value.getFullYear();
        const m = String(value.getMonth() + 1).padStart(2, '0');
        const d = String(value.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    if (typeof value === 'object') {
        if (value.result != null) return cellText(value.result);
        if (value.text != null) return cellText(value.text);
        if (Array.isArray(value.richText)) return value.richText.map((p) => p.text || '').join('');
    }
    return String(value).replace(/\s+/g, ' ').trim();
}

function normCompare(value) {
    const text = cellText(value).replace(/,/g, '').trim();
    if (!text) return '';
    if (/^-?\d+(\.\d+)?$/.test(text)) {
        const n = Number(text);
        if (Number.isFinite(n)) return String(n);
    }
    return text.replace(/\s+/g, '').toLowerCase();
}

function styleHeader(row) {
    row.font = { bold: true };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
    row.alignment = { vertical: 'middle', wrapText: true };
}

function loadRows(sheet, headerRow, startRow) {
    const rows = [];
    for (let r = startRow; r <= sheet.rowCount; r += 1) {
        const row = sheet.getRow(r);
        const seq = cellText(row.getCell(1).value);
        if (!seq) continue;
        const values = [];
        const max = Math.max(sheet.columnCount, headerRow ? 40 : 30);
        for (let c = 1; c <= max; c += 1) values[c] = cellText(row.getCell(c).value);
        rows.push({ seq, excelRow: r, values });
    }
    return rows;
}

(async () => {
    const registerWb = new ExcelJS.Workbook();
    const statusWb = new ExcelJS.Workbook();
    await registerWb.xlsx.readFile(registerPath);
    await statusWb.xlsx.readFile(statusPath);

    const registerSheet = registerWb.getWorksheet('물품관리대장-제출자료');
    const statusSheet = statusWb.getWorksheet('총괄');
    const registerRows = loadRows(registerSheet, 6, 7);
    const statusRows = loadRows(statusSheet, 3, 4);

    const regBySeq = new Map();
    const regAllBySeq = new Map();
    const statusBySeq = new Map();
    const regDup = [];
    const statusDup = [];
    registerRows.forEach((row) => {
        if (!regAllBySeq.has(row.seq)) regAllBySeq.set(row.seq, []);
        regAllBySeq.get(row.seq).push(row);
        if (regBySeq.has(row.seq)) regDup.push(row.seq);
        else regBySeq.set(row.seq, row);
    });
    statusRows.forEach((row) => {
        if (statusBySeq.has(row.seq)) statusDup.push(row.seq);
        else statusBySeq.set(row.seq, row);
    });

    // 상태내역서 「품명」은 대장의 자산명이다.
    // 상태 운영부서(8) = 대장 조사부서, 상태 운영부서(24) = 대장 운영부서.
    // 상태 사용위치 = 대장 「현 사용위치」. 규격은 쉼표 앞 품목명만 비교한다.
    const fields = [
        { key: '자산명', reg: 2, status: 4 },
        { key: '취득일자', reg: 3, status: 16 },
        { key: '수량', reg: 4, status: 15 },
        { key: '단가', reg: 5, status: 14 },
        { key: '보유여부', reg: 10, status: 21 },
        { key: '조사부서', reg: 8, status: 8 },
        { key: '운영부서', reg: 11, status: 24 },
        { key: '현사용위치', reg: 12, status: 9 },
        { key: '자산번호', reg: 18, status: 3 },
        { key: '분류번호', reg: 19, status: 10 },
        { key: '식별번호', reg: 21, status: 11 },
        { key: '내용연수', reg: 22, status: 17 },
        { key: '규격', reg: 23, status: 12, spec: true },
        { key: 'zeus번호', reg: 28, status: 19 }
    ];

    const onlyRegister = [];
    const onlyStatus = [];
    const diffs = [];
    const diffSeqs = new Set();
    const fieldCounts = Object.fromEntries(fields.map((f) => [f.key, 0]));

    const allSeqs = new Set([...regBySeq.keys(), ...statusBySeq.keys()]);
    [...allSeqs].sort((a, b) => Number(a) - Number(b) || String(a).localeCompare(String(b))).forEach((seq) => {
        const reg = regBySeq.get(seq);
        const status = statusBySeq.get(seq);
        if (reg && !status) {
            onlyRegister.push(reg);
            return;
        }
        if (status && !reg) {
            onlyStatus.push(status);
            return;
        }
        fields.forEach((field) => {
            const left = reg.values[field.reg] || '';
            const right = status.values[field.status] || '';
            const leftKey = field.spec ? normCompare(left.split(',')[0]) : normCompare(left);
            const rightKey = field.spec ? normCompare(right.split(',')[0]) : normCompare(right);
            if (leftKey === rightKey) return;
            fieldCounts[field.key] += 1;
            diffSeqs.add(seq);
            diffs.push({
                순번: seq,
                자산명: reg.values[2] || status.values[4],
                항목: field.key,
                자산대장: left,
                물품상태분류: right
            });
        });
    });

    const out = new ExcelJS.Workbook();
    out.creator = 'find-app';
    out.created = new Date();

    const summary = out.addWorksheet('요약');
    const summaryRows = [
        ['비교기준', '순번'],
        ['자산대장', path.basename(registerPath)],
        ['물품상태분류', path.basename(statusPath)],
        ['비교일시', new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })],
        ['자산대장 행수', registerRows.length],
        ['물품상태분류 행수', statusRows.length],
        ['양쪽 모두 있는 순번', allSeqs.size - onlyRegister.length - onlyStatus.length],
        ['자산대장에만 있는 순번', onlyRegister.length],
        ['물품상태분류에만 있는 순번', onlyStatus.length],
        ['값이 다른 순번', diffSeqs.size],
        ['값이 다른 항목 건수', diffs.length],
        ['순번 중복(대장)', regDup.length ? [...new Set(regDup)].join(', ') : '없음'],
        ['순번 중복(상태)', statusDup.length ? [...new Set(statusDup)].join(', ') : '없음'],
        ['비교 항목', fields.map((f) => f.key).join(', ')],
        ['이름 대응', '상태내역서의 품명 = 자산대장의 자산명'],
        ['위치 대응', '상태내역서 사용위치 = 자산대장 현 사용위치'],
        ['부서 대응', '상태내역서 운영부서(8열)=대장 조사부서, 운영부서(24열)=대장 운영부서'],
        ['규격 대응', '쉼표 앞 품목명이 같으면 동일. 제조사·모델 뒷부분은 차이로 보지 않음'],
        ['순번 중복 참고', '같은 순번이 대장에 여러 행이면 첫 행만 상태내역서와 비교하고, 나머지는 「순번중복」시트에 둔다']
    ];
    summaryRows.forEach((row) => summary.addRow(row));
    summary.addRow([]);
    summary.addRow(['항목', '차이 건수']);
    styleHeader(summary.getRow(summary.rowCount));
    fields.forEach((field) => summary.addRow([field.key, fieldCounts[field.key]]));
    summary.getColumn(1).width = 28;
    summary.getColumn(2).width = 88;

    const diffSheet = out.addWorksheet('값차이');
    diffSheet.addRow(['순번', '자산명', '항목', '자산대장', '물품상태분류']);
    styleHeader(diffSheet.getRow(1));
    diffs.forEach((row) => diffSheet.addRow([row.순번, row.자산명, row.항목, row.자산대장, row.물품상태분류]));
    diffSheet.autoFilter = { from: 'A1', to: 'E1' };
    diffSheet.views = [{ state: 'frozen', ySplit: 1 }];
    [12, 28, 16, 36, 36].forEach((w, i) => { diffSheet.getColumn(i + 1).width = w; });

    const onlyRegSheet = out.addWorksheet('대장에만있음');
    onlyRegSheet.addRow(['순번', '자산명', '취득일자', '취득수량', '단가', '보유여부', '운영부서', '자산번호', '분류번호', '식별번호', '내용연수', '운영여부']);
    styleHeader(onlyRegSheet.getRow(1));
    onlyRegister.forEach((row) => {
        const v = row.values;
        onlyRegSheet.addRow([row.seq, v[2], v[3], v[4], v[5], v[10], v[11], v[18], v[19], v[21], v[22], v[32]]);
    });
    onlyRegSheet.views = [{ state: 'frozen', ySplit: 1 }];
    onlyRegSheet.columns.forEach((col) => { col.width = 16; });
    onlyRegSheet.getColumn(2).width = 28;

    const onlyStatusSheet = out.addWorksheet('상태분류에만있음');
    onlyStatusSheet.addRow(['순번', '품명', '취득일자', '수량', '단가', '보유여부', '운영부서', '자산번호', '분류번호', '식별번호', '내용연수', '실사구분', '진행방향']);
    styleHeader(onlyStatusSheet.getRow(1));
    onlyStatus.forEach((row) => {
        const v = row.values;
        onlyStatusSheet.addRow([row.seq, v[4], v[16], v[15], v[14], v[21], v[8], v[3], v[10], v[11], v[17], v[5], v[25]]);
    });
    onlyStatusSheet.views = [{ state: 'frozen', ySplit: 1 }];
    onlyStatusSheet.columns.forEach((col) => { col.width = 16; });
    onlyStatusSheet.getColumn(2).width = 28;

    const dupSheet = out.addWorksheet('순번중복');
    dupSheet.addRow(['순번', '대장엑셀행', '자산명', '취득일자', '수량', '단가', '조사부서', '운영부서', '현사용위치', '자산번호', '규격', '상태내역서품명']);
    styleHeader(dupSheet.getRow(1));
    [...regAllBySeq.entries()]
        .filter(([, rows]) => rows.length > 1)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .forEach(([seq, rows]) => {
            const statusName = statusBySeq.get(seq)?.values[4] || '';
            rows.forEach((row) => {
                const v = row.values;
                dupSheet.addRow([seq, row.excelRow, v[2], v[3], v[4], v[5], v[8], v[11], v[12], v[18], v[23], statusName]);
            });
        });
    dupSheet.views = [{ state: 'frozen', ySplit: 1 }];
    dupSheet.columns.forEach((col) => { col.width = 16; });
    dupSheet.getColumn(3).width = 28;
    dupSheet.getColumn(11).width = 36;

    const stamp = new Date().toISOString().slice(0, 10);
    const outName = `순번비교_자산대장_물품상태분류_${stamp}.xlsx`;
    const outPath = path.join(desktop, outName);
    await out.xlsx.writeFile(outPath);

    console.log(JSON.stringify({
        register: registerRows.length,
        status: statusRows.length,
        onlyRegister: onlyRegister.length,
        onlyStatus: onlyStatus.length,
        diffSeqs: diffSeqs.size,
        diffs: diffs.length,
        fieldCounts,
        out: outName
    }, null, 2));
})().catch((error) => {
    console.error(error);
    process.exit(1);
});

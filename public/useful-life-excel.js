// 내용연수 분석 엑셀 — 후보 드롭다운으로 고르고, 다시 올리면 앱에 반영한다
// ExcelJS(CDN)로 데이터 유효성(드롭다운)을 넣는다. SheetJS만으로는 드롭다운 쓰기가 안 된다.

const UL_EXCEL_SHEET_MAIN = '내용연수';
const UL_EXCEL_SHEET_NEED = '확인필요';
const UL_EXCEL_SHEET_CUSTOM = '본인확인';
const UL_EXCEL_SHEET_HELP = '사용안내';
const UL_EXCEL_CANDIDATE_LIMIT = 20;
const UL_EXCEL_SELECT_HEADER = '선택분류';
const UL_EXCEL_DIRECT_HEADER = '직접분류';

function formatUsefulLifeSelectOption(candidate) {
    if (!candidate) return '';
    const years = candidate.notified && candidate.usefulLife > 0
        ? `${candidate.usefulLife}년`
        : '미고시';
    return `${candidate.goodsClNm} [${candidate.goodsClNo}] · ${years}`;
}

function parseUsefulLifeSelectOption(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    const matched = text.match(/^(.+?)\s*\[(\d{6,10})\]/);
    if (matched) {
        return {
            goodsClNm: matched[1].trim(),
            goodsClNo: matched[2]
        };
    }
    // 분류번호만 적은 경우
    if (/^\d{6,10}$/.test(text)) return { goodsClNo: text, goodsClNm: '' };
    return { goodsClNm: text, goodsClNo: '' };
}

function usefulLifeChosenClass(row) {
    return String(row?.[UL_EXCEL_DIRECT_HEADER] || '').trim()
        || String(row?.[UL_EXCEL_SELECT_HEADER] || '').trim();
}

function usefulLifeStatusLabelKo(status) {
    return ({
        ok: '정상',
        due: '임박',
        expired: '만료',
        unknown: '미산정'
    })[status] || status || '';
}

function usefulLifeVerdictLabelKo(verdict) {
    return ({
        resolved: '확정',
        unnotified: '미고시',
        ambiguous: '확인필요',
        missing: '못찾음'
    })[verdict] || verdict || '';
}

function buildUsefulLifeExcelRow(item, options = {}) {
    const life = typeof describeUsefulLife === 'function'
        ? describeUsefulLife({
            itemName: item.itemName,
            goodsClNo: item.goodsClNo,
            acquiredAt: item.acquiredAt
        })
        : null;

    const resolvedEntry = life?.entry || (life?.goodsClNo ? {
        goodsClNo: life.goodsClNo,
        goodsClNm: life.goodsClNm,
        usefulLife: life.usefulLife,
        notified: life.notified
    } : null);

    const candidates = [];
    const seen = new Set();
    const pushCandidate = (candidate) => {
        if (!candidate?.goodsClNo || seen.has(candidate.goodsClNo)) return;
        if (candidates.length >= UL_EXCEL_CANDIDATE_LIMIT) return;
        seen.add(candidate.goodsClNo);
        candidates.push(candidate);
    };
    if (resolvedEntry) pushCandidate(resolvedEntry);
    (life?.candidates || []).forEach(pushCandidate);
    if (typeof collectUsefulLifeBroadCandidates === 'function') {
        collectUsefulLifeBroadCandidates(item.itemName, UL_EXCEL_CANDIDATE_LIMIT).forEach(pushCandidate);
    }

    const selected = resolvedEntry ? formatUsefulLifeSelectOption(resolvedEntry) : '';

    const candidateOptions = candidates.map(formatUsefulLifeSelectOption).filter(Boolean);
    const timestamp = typeof getSafeDate === 'function'
        ? getSafeDate(item.timestamp)
        : (item.timestamp?.toDate?.() || null);

    return {
        item,
        life,
        candidateOptions,
        selected,
        values: {
            '대상': options.targetLabel || '조사',
            '문서ID': item.id || '',
            '조사회차': item.surveyName || '',
            '자산번호': item.assetNumber || '',
            '물품명': item.itemName || '',
            '취득일자': item.acquiredAt || life?.acquiredAt || '',
            '현재분류번호': item.goodsClNo || life?.goodsClNo || '',
            '현재분류명': item.goodsClNm || life?.goodsClNm || '',
            '내용연수(년)': item.usefulLife || life?.usefulLife || '',
            '만료일자': life?.expiry || '',
            '잔여상태': usefulLifeStatusLabelKo(life?.status),
            '매칭상태': usefulLifeVerdictLabelKo(life?.verdict),
            [UL_EXCEL_SELECT_HEADER]: selected,
            '후보1': candidateOptions[0] || '',
            '후보2': candidateOptions[1] || '',
            '후보3': candidateOptions[2] || '',
            '후보4': candidateOptions[3] || '',
            '후보5': candidateOptions[4] || '',
            '후보6': candidateOptions[5] || '',
            '후보7': candidateOptions[6] || '',
            '후보8': candidateOptions[7] || '',
            '비고': life?.note || '',
            '조사자': item.surveyor || '',
            '기관명': item.organization || '',
            '사용위치': item.location || '',
            '조사일시': timestamp ? timestamp.toLocaleString('ko-KR') : ''
        }
    };
}

const UL_EXCEL_HEADERS = [
    '대상', '문서ID', '조사회차', '자산번호', '물품명', '취득일자',
    '현재분류번호', '현재분류명', '내용연수(년)', '만료일자', '잔여상태', '매칭상태',
    UL_EXCEL_SELECT_HEADER, '후보1', '후보2', '후보3', '후보4', '후보5', '후보6', '후보7', '후보8',
    '비고', '조사자', '기관명', '사용위치', '조사일시'
];

async function ensureExcelJS() {
    if (typeof ExcelJS !== 'undefined') return ExcelJS;
    await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
        script.onload = resolve;
        script.onerror = () => reject(new Error('ExcelJS를 불러오지 못했습니다'));
        document.head.appendChild(script);
    });
    if (typeof ExcelJS === 'undefined') throw new Error('ExcelJS를 사용할 수 없습니다');
    return ExcelJS;
}

function styleUsefulLifeHeader(row) {
    row.font = { bold: true };
    row.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE5E7EB' }
    };
    row.alignment = { vertical: 'middle', wrapText: true };
}

function usefulLifeSheetHeaders(name) {
    if (name !== UL_EXCEL_SHEET_NEED) return UL_EXCEL_HEADERS;
    const headers = [...UL_EXCEL_HEADERS];
    const at = headers.indexOf(UL_EXCEL_SELECT_HEADER);
    headers.splice(at + 1, 0, UL_EXCEL_DIRECT_HEADER);
    return headers;
}

function excelColName(index) {
    let n = index;
    let name = '';
    while (n > 0) {
        const rem = (n - 1) % 26;
        name = String.fromCharCode(65 + rem) + name;
        n = Math.floor((n - 1) / 26);
    }
    return name;
}

function addUsefulLifeSheet(workbook, name, rows) {
    const headers = usefulLifeSheetHeaders(name);
    const sheet = workbook.addWorksheet(name, {
        views: [{ state: 'frozen', ySplit: 1 }]
    });
    sheet.addRow(headers);
    styleUsefulLifeHeader(sheet.getRow(1));

    const selectCol = headers.indexOf(UL_EXCEL_SELECT_HEADER) + 1;
    const directCol = headers.indexOf(UL_EXCEL_DIRECT_HEADER) + 1;

    rows.forEach((row) => {
        const excelRow = sheet.addRow(headers.map((header) => row.values[header] ?? ''));
        const verdict = row.life?.verdict;
        if (verdict === 'ambiguous' || verdict === 'missing') {
            excelRow.getCell(selectCol).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFFEF3C7' }
            };
        } else if (verdict === 'resolved') {
            excelRow.getCell(selectCol).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFD1FAE5' }
            };
        }
        if (directCol > 0) {
            excelRow.getCell(directCol).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFDBEAFE' }
            };
        }
    });

    sheet.columns = headers.map((header) => {
        const widthMap = {
            '문서ID': 22,
            '대상': 8,
            '물품명': 22,
            [UL_EXCEL_SELECT_HEADER]: 36,
            [UL_EXCEL_DIRECT_HEADER]: 40,
            '후보1': 32,
            '후보2': 32,
            '후보3': 32,
            '후보4': 28,
            '후보5': 28,
            '후보6': 28,
            '후보7': 28,
            '후보8': 28,
            '사용위치': 18,
            '조사일시': 18
        };
        return { width: widthMap[header] || 12 };
    });

    attachUsefulLifeDropdowns(workbook, name, rows, headers);
    return sheet;
}

// 후보가 12개면 인라인 목록(255자)을 넘으므로 숨은 시트의 범위를 드롭다운으로 쓴다
function attachUsefulLifeDropdowns(workbook, sheetName, rows, headers) {
    const dataSheet = workbook.getWorksheet(sheetName);
    if (!dataSheet) return;
    const lookupName = `_후보_${sheetName}`.slice(0, 31);
    const lookup = workbook.addWorksheet(lookupName, { state: 'hidden' });
    const selectCol = headers.indexOf(UL_EXCEL_SELECT_HEADER) + 1;

    rows.forEach((row, index) => {
        const options = (row.candidateOptions || []).slice(0, UL_EXCEL_CANDIDATE_LIMIT);
        if (!options.length) return;
        options.forEach((option, col) => {
            lookup.getCell(index + 1, col + 1).value = option;
        });
        const end = excelColName(options.length);
        const lookupRow = index + 1;
        const address = dataSheet.getRow(index + 2).getCell(selectCol).address;
        dataSheet.dataValidations.add(address, {
            type: 'list',
            allowBlank: true,
            showErrorMessage: false,
            formulae: [`'${lookupName}'!$A$${lookupRow}:$${end}$${lookupRow}`]
        });
    });
}

function addUsefulLifeHelpSheet(workbook) {
    const sheet = workbook.addWorksheet(UL_EXCEL_SHEET_HELP);
    const lines = [
        ['내용연수 분석 엑셀 사용 방법'],
        [''],
        ['1. "확인필요" 시트의 선택분류 드롭다운에서 비슷한 물품을 고릅니다.'],
        ['2. 드롭다운에 없는 분류는 같은 시트의 직접분류(파란 칸)에 적습니다. 예: 디지털카메라 [45121504] · 8년'],
        ['3. 직접분류가 있으면 선택분류보다 우선해서 반영됩니다.'],
        ['4. 저장한 파일을 앱의 "선택분류 반영"으로 다시 올립니다.']
    ];
    lines.forEach((line) => sheet.addRow(line));
    sheet.getColumn(1).width = 110;
    sheet.getRow(1).font = { bold: true, size: 14 };
}

async function downloadUsefulLifeWorkbook(rows, fileName) {
    const Excel = await ensureExcelJS();
    const workbook = new Excel.Workbook();
    workbook.creator = '물품 조사 시스템';
    workbook.created = new Date();

    addUsefulLifeSheet(workbook, UL_EXCEL_SHEET_MAIN, rows);
    const needRows = rows.filter((row) =>
        row.life?.verdict === 'ambiguous' || row.life?.verdict === 'missing'
    );
    addUsefulLifeSheet(workbook, UL_EXCEL_SHEET_NEED, needRows);
    addUsefulLifeHelpSheet(workbook);

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

async function exportUsefulLifeExcel() {
    const exportItems = typeof getItemsForView === 'function' ? getItemsForView() : [];
    if (!exportItems.length) {
        showToast('다운로드할 데이터가 없습니다', 'error');
        return;
    }

    try {
        if (typeof ensureUsefulLifeTable === 'function') {
            await ensureUsefulLifeTable();
        }
        showToast('내용연수 분석 엑셀을 만드는 중...', 'info');
        const rows = exportItems.map((item) => buildUsefulLifeExcelRow(item, { targetLabel: '조사' }));
        const surveyLabel = (typeof getCurrentSurvey === 'function' && getCurrentSurvey()?.name) || '선택회차';
        const needCount = rows.filter((row) =>
            row.life?.verdict === 'ambiguous' || row.life?.verdict === 'missing'
        ).length;
        await downloadUsefulLifeWorkbook(
            rows,
            `내용연수분석_${surveyLabel}_${new Date().toISOString().split('T')[0]}.xlsx`
        );
        showToast(
            `내용연수 엑셀 완료 · 확인필요 ${needCount}건 / 전체 ${rows.length}건`,
            'success'
        );
    } catch (error) {
        console.error('내용연수 엑셀 내보내기 실패:', error);
        showToast('내용연수 엑셀 내보내기에 실패했습니다', 'error');
    }
}

async function exportUsefulLifeRegisterExcel() {
    const register = typeof getRegisterForSurvey === 'function' ? getRegisterForSurvey() : [];
    if (!register.length) {
        showToast('분석할 대장이 없습니다. 관리 탭에서 대장 엑셀을 먼저 올리세요', 'error');
        return;
    }

    try {
        if (typeof ensureUsefulLifeTable === 'function') {
            await ensureUsefulLifeTable();
        }
        showToast('대장 내용연수 엑셀을 만드는 중...', 'info');
        const rows = register.map((record) => buildUsefulLifeExcelRow(record, { targetLabel: '대장' }));
        const surveyLabel = (typeof getCurrentSurvey === 'function' && getCurrentSurvey()?.name) || '선택회차';
        const needCount = rows.filter((row) =>
            row.life?.verdict === 'ambiguous' || row.life?.verdict === 'missing'
        ).length;
        await downloadUsefulLifeWorkbook(
            rows,
            `대장_내용연수분석_${surveyLabel}_${new Date().toISOString().split('T')[0]}.xlsx`
        );
        showToast(
            `대장 내용연수 엑셀 완료 · 확인필요 ${needCount}건 / 전체 ${rows.length}건`,
            'success'
        );
    } catch (error) {
        console.error('대장 내용연수 엑셀 내보내기 실패:', error);
        showToast('대장 내용연수 엑셀 내보내기에 실패했습니다', 'error');
    }
}

function usefulLifeImportRowKey(row) {
    const docId = String(row['문서ID'] || '').trim();
    if (docId) return `id:${docId}`;
    const asset = String(row['자산번호'] || '').trim();
    if (asset) return `asset:${asset}`;
    const name = String(row['물품명'] || '').trim();
    if (name && usefulLifeChosenClass(row)) return `name:${name}`;
    return '';
}

function usefulLifeExcelRowsFromSheet(sheetRows) {
    if (!Array.isArray(sheetRows) || !sheetRows.length) return [];
    return sheetRows.filter((row) => {
        if (!usefulLifeImportRowKey(row)) return false;
        return Boolean(usefulLifeChosenClass(row) || String(row['현재분류번호'] || '').trim());
    });
}

// 내용연수·확인필요·본인확인을 합친다. 직접분류가 있으면 선택분류보다 우선한다.
function collectUsefulLifeImportRows(workbook) {
    const byKey = new Map();
    const sheetOrder = [
        UL_EXCEL_SHEET_MAIN,
        UL_EXCEL_SHEET_NEED,
        UL_EXCEL_SHEET_CUSTOM,
        '수동입력',
        ...workbook.SheetNames.filter((name) =>
            name !== UL_EXCEL_SHEET_MAIN
            && name !== UL_EXCEL_SHEET_NEED
            && name !== UL_EXCEL_SHEET_CUSTOM
            && name !== '수동입력'
            && name !== UL_EXCEL_SHEET_HELP
            && !String(name).startsWith('_후보'))
    ];

    sheetOrder.forEach((name) => {
        const sheet = workbook.Sheets[name];
        if (!sheet) return;
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        rows.forEach((row) => {
            const key = usefulLifeImportRowKey(row);
            if (!key) return;
            const chosen = usefulLifeChosenClass(row);
            const direct = String(row[UL_EXCEL_DIRECT_HEADER] || '').trim();
            const prev = byKey.get(key);
            if (!prev) {
                byKey.set(key, row);
                return;
            }
            const prevDirect = String(prev[UL_EXCEL_DIRECT_HEADER] || '').trim();
            if (direct) {
                byKey.set(key, row);
                return;
            }
            if (prevDirect || name === UL_EXCEL_SHEET_CUSTOM || name === '수동입력') return;
            if (chosen) byKey.set(key, row);
        });
    });

    return {
        rows: usefulLifeExcelRowsFromSheet([...byKey.values()]),
        pendingConfirm: 0,
        usesConfirm: false
    };
}

function resolveUsefulLifeRegisterId(row) {
    const docId = String(row['문서ID'] || '').trim();
    if (docId) return { docId, reason: '' };
    const asset = String(row['자산번호'] || '').trim();
    if (!asset || typeof registerItems === 'undefined' || !Array.isArray(registerItems)) {
        return { docId: '', reason: 'alias-only' };
    }
    const norm = typeof normalizeAsset === 'function'
        ? normalizeAsset(asset)
        : asset.toLowerCase();
    const hits = registerItems.filter((record) => {
        const value = typeof normalizeAsset === 'function'
            ? normalizeAsset(record.assetNumber)
            : String(record.assetNumber || '').toLowerCase();
        return value && value === norm;
    });
    if (hits.length === 1) return { docId: hits[0].id, reason: '' };
    if (hits.length > 1) return { docId: '', reason: 'asset-ambiguous' };
    return { docId: '', reason: 'alias-only' };
}

function resolveUsefulLifeSelection(parsed) {
    if (!parsed) return null;
    if (parsed.goodsClNo && typeof lookupUsefulLifeByCode === 'function') {
        const byCode = lookupUsefulLifeByCode(parsed.goodsClNo);
        if (byCode) return byCode;
    }
    if (parsed.goodsClNm && typeof matchUsefulLife === 'function') {
        const byName = matchUsefulLife(parsed.goodsClNm);
        if (byName.entry) return byName.entry;
    }
    if (parsed.goodsClNo) {
        return {
            goodsClNo: parsed.goodsClNo,
            goodsClNm: parsed.goodsClNm || '',
            usefulLife: 0,
            notified: false,
            match: 'import'
        };
    }
    return null;
}

function resolveUsefulLifeImportTarget(row, preferred) {
    const docId = String(row['문서ID'] || '').trim();
    const marked = String(row['대상'] || '').trim();
    if (preferred === 'register' || marked === '대장') return 'register';
    if (preferred === 'items' || marked === '조사') return 'items';
    if (typeof registerItems !== 'undefined' && Array.isArray(registerItems)
        && registerItems.some((record) => record.id === docId)) {
        return 'register';
    }
    return 'items';
}

async function applyUsefulLifeExcelSelection(row, options = {}) {
    const direct = String(row[UL_EXCEL_DIRECT_HEADER] || '').trim();
    let selected = direct || String(row[UL_EXCEL_SELECT_HEADER] || '').trim();
    if (!selected) {
        const code = String(row['현재분류번호'] || '').trim();
        const name = String(row['현재분류명'] || '').trim();
        if (code) {
            selected = name ? `${name} [${code}]` : code;
        }
    }
    const resolvedId = resolveUsefulLifeRegisterId(row);
    const docId = resolvedId.docId;
    if (!selected) return { skipped: true, reason: 'empty' };
    if (resolvedId.reason === 'asset-ambiguous') return { skipped: true, reason: 'asset-ambiguous' };

    if (docId && typeof isLocalItemId === 'function' && isLocalItemId(docId)) {
        return { skipped: true, reason: 'local' };
    }

    const parsed = parseUsefulLifeSelectOption(selected);
    const entry = resolveUsefulLifeSelection(parsed);
    if (!entry || !entry.goodsClNo) return { skipped: true, reason: 'unresolved' };

    const patch = {
        goodsClNo: entry.goodsClNo,
        goodsClNm: entry.goodsClNm || parsed.goodsClNm || '',
        usefulLife: Number(entry.usefulLife) || 0,
        usefulLifeMatch: direct ? 'manual' : (entry.match || 'import'),
        usefulLifeUpdatedAt: new Date().toISOString()
    };

    const target = docId ? resolveUsefulLifeImportTarget({ ...row, 문서ID: docId }, options.target) : 'alias';
    if (target === 'register' && docId) {
        if (typeof updateRegisterRecord !== 'function') {
            return { skipped: true, reason: 'no-register-api' };
        }
        const inMemory = typeof registerItems !== 'undefined'
            && Array.isArray(registerItems)
            && registerItems.some((record) => record.id === docId);
        if (!inMemory && !options.allowMissingRegister) {
            return { skipped: true, reason: 'register-not-loaded' };
        }
        if (!options.deferWrite) {
            await updateRegisterRecord(docId, patch);
        }
    } else if (target === 'items' && docId) {
        const local = typeof items !== 'undefined' ? items.find((item) => item.id === docId) : null;
        if (!local && String(docId).startsWith('rg_')) {
            return { skipped: true, reason: 'register-not-loaded' };
        }
        const payload = local
            ? patch
            : {
                ...patch,
                userId: currentUser?.uid || '',
                userEmail: currentUser?.email || ''
            };
        if (!payload.userId && !local) {
            return { skipped: true, reason: 'login-required' };
        }
        await db.collection('items').doc(docId).set(payload, { merge: true });
        if (local) Object.assign(local, patch);
    }

    const registerHit = typeof registerItems !== 'undefined'
        ? registerItems.find((record) => record.id === docId)
        : null;
    const itemName = String(row['물품명'] || registerHit?.itemName || '').trim();
    let learned = false;
    if (itemName && typeof saveUsefulLifeAlias === 'function' && options.learn !== false) {
        try {
            await saveUsefulLifeAlias({
                nameKey: itemName,
                goodsClNo: patch.goodsClNo,
                goodsClNm: patch.goodsClNm,
                usefulLife: patch.usefulLife
            });
            learned = true;
        } catch (error) {
            console.warn('내용연수 학습 저장 실패:', error);
        }
    } else if (!docId && !itemName) {
        return { skipped: true, reason: 'empty' };
    }

    return {
        updated: true,
        docId,
        goodsClNo: patch.goodsClNo,
        target: docId ? target : 'alias',
        patch,
        learned,
        itemName
    };
}

async function importUsefulLifeExcelFile(file, options = {}) {
    if (!file) return;
    if (typeof ensureUsefulLifeTable === 'function') {
        await ensureUsefulLifeTable();
    }
    if (typeof XLSX === 'undefined') {
        throw new Error('엑셀 라이브러리(XLSX)를 불러오지 못했습니다');
    }

    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array' });
    const collected = collectUsefulLifeImportRows(workbook);
    const rows = collected.rows || [];
    const pendingConfirm = collected.pendingConfirm || 0;

    if (!rows.length) {
        showToast(
            '반영할 선택분류가 없습니다. 확인필요 시트에서 선택분류를 고르거나, 직접분류에 없는 분류를 적으세요',
            'error'
        );
        return;
    }

    let updated = 0;
    let skipped = 0;
    let failed = 0;
    let learnedFail = 0;
    const failReasons = [];
    const registerBulk = [];

    showToast(`${rows.length}건 반영 중...`, 'info');
    for (const row of rows) {
        try {
            const target = resolveUsefulLifeImportTarget(row, options.target);
            const deferWrite = target === 'register' && typeof updateRegisterRecordsBulk === 'function';
            const result = await applyUsefulLifeExcelSelection(row, { ...options, deferWrite });
            if (result.updated) {
                if (deferWrite && result.target === 'register' && result.docId && result.patch) {
                    registerBulk.push({ registerId: result.docId, patch: result.patch });
                }
                updated += 1;
                if (result.itemName && result.learned === false) learnedFail += 1;
            } else {
                skipped += 1;
                if (result.reason) failReasons.push(result.reason);
            }
        } catch (error) {
            console.warn('내용연수 선택 반영 실패:', row, error);
            failed += 1;
            failReasons.push(error.code || error.message || 'error');
        }
    }

    if (registerBulk.length && typeof updateRegisterRecordsBulk === 'function') {
        try {
            await updateRegisterRecordsBulk(registerBulk);
        } catch (error) {
            console.warn('대장 일괄 반영 실패, 건별 재시도:', error);
            for (const entry of registerBulk) {
                try {
                    await updateRegisterRecord(entry.registerId, entry.patch);
                } catch (rowError) {
                    console.warn('대장 건별 반영 실패:', entry.registerId, rowError);
                    failed += 1;
                    updated = Math.max(0, updated - 1);
                    failReasons.push(rowError.code || rowError.message || 'register-write');
                }
            }
        }
    }

    try {
        if (typeof displayItems === 'function') displayItems();
        if (typeof updateDashboard === 'function') updateDashboard();
        if (typeof refreshRegisterViews === 'function') refreshRegisterViews();
    } catch (error) {
        console.warn('반영 후 화면 갱신 실패:', error);
    }
    if (typeof refreshUsefulLifeRegisterTab === 'function') {
        try {
            await refreshUsefulLifeRegisterTab();
        } catch (error) {
            console.warn('내용연수 탭 갱신 실패:', error);
        }
    }

    if (!updated && failed) {
        const detail = failReasons.slice(0, 3).join(', ');
        throw new Error(`내용연수 반영 실패 (${detail})`);
    }
    if (!updated && skipped) {
        const detail = failReasons.slice(0, 3).join(', ');
        showToast(
            detail.includes('register-not-loaded')
                ? '반영할 대장 행을 앱에서 찾지 못했습니다. 대장 탭에 같은 회차 대장이 열려 있는지 확인하세요'
                : `반영할 행이 없습니다 (${detail || 'skipped'})`,
            'error'
        );
        return;
    }

    const learnNote = learnedFail ? ` · 학습실패 ${learnedFail}` : '';
    const confirmNote = pendingConfirm ? ` / 미확인 ${pendingConfirm}` : '';
    showToast(
        `내용연수 반영 완료 · 적용 ${updated} / 건너뜀 ${skipped}${confirmNote}${failed ? ` / 실패 ${failed}` : ''}${learnNote}`,
        failed ? 'error' : 'success'
    );
}

function bindUsefulLifeExcelUi() {
    const exportBtn = document.getElementById('exportUsefulLifeExcel');
    if (exportBtn) exportBtn.addEventListener('click', exportUsefulLifeExcel);

    const importBtn = document.getElementById('importUsefulLifeExcelBtn');
    const importInput = document.getElementById('importUsefulLifeExcelFile');
    if (importBtn && importInput) {
        importBtn.addEventListener('click', () => importInput.click());
        importInput.addEventListener('change', async (event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            try {
                await importUsefulLifeExcelFile(file, { target: 'items' });
            } catch (error) {
                console.error('내용연수 엑셀 반영 실패:', error);
                showToast(error?.message || '내용연수 선택 반영에 실패했습니다', 'error');
            }
        });
    }
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindUsefulLifeExcelUi);
    } else {
        bindUsefulLifeExcelUi();
    }
}

window.exportUsefulLifeExcel = exportUsefulLifeExcel;
window.exportUsefulLifeRegisterExcel = exportUsefulLifeRegisterExcel;
window.importUsefulLifeExcelFile = importUsefulLifeExcelFile;
window.parseUsefulLifeSelectOption = parseUsefulLifeSelectOption;
window.formatUsefulLifeSelectOption = formatUsefulLifeSelectOption;
window.usefulLifeChosenClass = usefulLifeChosenClass;
window.collectUsefulLifeImportRows = collectUsefulLifeImportRows;
window.buildUsefulLifeExcelRow = buildUsefulLifeExcelRow;

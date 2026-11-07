/**
 * RFID_OAST 취득재산 일괄등록 양식 변환
 * 원본 자산대장 → RFID_OAST_TEMPLET 8행 헤더 아래(9행~) 채우기
 */

const RFID_OAST_TEMPLATE_URL = 'templates/RFID_OAST_TEMPLET.xls';
const RFID_OAST_SHEET = '취득재산추가일괄등록';
const RFID_OAST_HEADER_ROW = 7; // 0-based → 엑셀 8행
const RFID_OAST_DATA_START = 8; // 0-based → 엑셀 9행

const RFID_OAST_DEFAULTS = {
    deptCode: '6880',
    ledgerCode: '1',
    domesticCode: '1',
    countryCode: 'KR',
    acquireReason: '0403'
};

/** 목표 양식 열 정의 (순서 = 템플릿 열 순서) */
const RFID_OAST_FIELDS = [
    {
        key: 'goodsClNo',
        label: '＊물품분류번호',
        required: true,
        // 세부품명번호는 분류가 아님 — 별도 조회로만 사용
        aliases: ['물품분류번호', '분류번호', '품명번호', '물품코드']
    },
    {
        key: 'goodsClNm',
        label: '품명',
        aliases: ['품명', '분류명', '물품분류명', '고시품명']
    },
    {
        key: 'assetId',
        label: '＊물품식별번호',
        required: true,
        // 기관 식별번호 우선 (8자리). 긴 자산번호/RFID는 목록정보 키가 아님
        aliases: ['물품식별번호', '식별번호', '자산번호', 'rfid번호', 'zeus번호', '관리번호', '태그']
    },
    {
        key: 'itemName',
        label: '품목명',
        aliases: ['품목명', '자산명', '물품명', '명칭', '품목']
    },
    {
        key: 'acquiredAt',
        label: '＊취득일자',
        required: true,
        aliases: ['취득일자', '취득년월일', '취득일', '구입일자', '구매일자']
    },
    {
        key: 'quantity',
        label: '＊취득수량',
        required: true,
        aliases: ['취득수량', '수량', '갯수', 'qty']
    },
    {
        key: 'unitPrice',
        label: '＊취득단가',
        required: true,
        aliases: ['취득단가', '단가', '구입단가', 'unitprice']
    },
    {
        key: 'amount',
        label: '금액',
        aliases: ['금액', '취득가액', '취득금액', '가액']
    },
    {
        key: 'bookValue',
        label: '장부가액',
        aliases: ['장부가액', '장부금액']
    },
    {
        key: 'depreciation',
        label: '감가상각누계금액',
        aliases: ['감가상각누계금액', '감가상각', '감가상각누계']
    },
    {
        key: 'usefulLife',
        label: '내용연수',
        aliases: ['내용연수', '내용년수', '내용연수(년)']
    },
    {
        key: 'deptCode',
        label: '＊운영부서(코드)',
        required: true,
        defaultKey: 'deptCode',
        aliases: ['운영부서', '운영부서코드', '부서코드']
    },
    {
        key: 'ledgerCode',
        label: '＊물품대장코드',
        required: true,
        defaultKey: 'ledgerCode',
        aliases: ['물품대장코드', '대장코드']
    },
    {
        key: 'manager',
        label: '물품담당자',
        aliases: ['물품담당자', '담당자', '성명(물품담당자)', '3)성명(물품담당자)']
    },
    {
        key: 'location',
        label: '사용위치',
        aliases: ['사용위치', '현 사용위치', '위치', '설치위치']
    },
    {
        key: 'domesticCode',
        label: '＊국내외구분(코드)',
        required: true,
        defaultKey: 'domesticCode',
        aliases: ['국내외구분', '국내외']
    },
    {
        key: 'countryCode',
        label: '＊국가코드(코드)',
        required: true,
        defaultKey: 'countryCode',
        aliases: ['국가코드', '국가']
    },
    {
        key: 'accountName',
        label: '회계구분명',
        aliases: ['회계구분명', '회계구분', '계정과목명', '계정과목']
    },
    {
        key: 'acquireReason',
        label: '＊취득사유(코드)',
        required: true,
        defaultKey: 'acquireReason',
        aliases: ['취득사유', '취득사유코드']
    },
    {
        key: 'leaseType',
        label: '리스구분코드',
        aliases: ['리스구분코드', '리스구분']
    },
    {
        key: 'leasePrice',
        label: '리스가격',
        aliases: ['리스가격']
    },
    {
        key: 'leaseStart',
        label: '리스시작일자',
        aliases: ['리스시작일자']
    },
    {
        key: 'leaseEnd',
        label: '리스종료일자',
        aliases: ['리스종료일자']
    },
    {
        key: 'note',
        label: '비고',
        aliases: ['비고', '4) 비고', '특이사항', '특이사항 처리방법']
    }
];

/** 코드 필드별 참조표·이름 열 별칭 */
const RFID_CODE_REF_SPECS = {
    deptCode: {
        // 등재물품 파일 「운영부서」시트: 운영부서(코드) | 운영부서
        sheetHints: ['운영부서', '운영부서코드', '부서코드', '사용자별운영부서'],
        codeHeaders: ['운영부서(코드)', '운영부서코드', '부서코드', '코드', 'code'],
        nameHeaders: ['운영부서', '운영부서명', '부서명', '명칭', '명', 'name'],
        nameAliases: ['운영부서', '운영부서명', '소속', '조사부서', '관리부서', '사용부서', '부서명']
    },
    ledgerCode: {
        sheetHints: ['물품대장', '물품대장코드', '대장코드'],
        codeHeaders: ['물품대장코드', '대장코드', '코드', 'code'],
        nameHeaders: ['물품대장명', '대장명', '명칭', '명', 'name'],
        nameAliases: ['물품대장', '물품대장코드', '대장코드', '계정과목명', '계정과목'],
        inline: [
            { code: '1', names: ['내구성물품대장', '내구성', '1'] },
            { code: 'B', names: ['소프트웨어대장', '소프트웨어', 'B'] }
        ]
    },
    domesticCode: {
        sheetHints: ['국내외', '국내외구분'],
        codeHeaders: ['국내외구분코드', '코드', 'code'],
        nameHeaders: ['국내외구분명', '국내외구분', '명칭', '명'],
        nameAliases: ['국내외구분', '국내외'],
        inline: [
            { code: '1', names: ['국내', '1'] },
            { code: '2', names: ['국외', '2'] }
        ]
    },
    countryCode: {
        sheetHints: ['국가코드', '국가'],
        codeHeaders: ['국가코드', '코드', 'code'],
        nameHeaders: ['국가명', '국가', '명칭', '명', 'name'],
        nameAliases: ['국가코드', '국가', '국가명']
    },
    acquireReason: {
        sheetHints: ['취득사유코드', '취득사유'],
        codeHeaders: ['취득사유코드', '사유코드', '코드', 'code'],
        nameHeaders: ['취득사유명', '취득사유', '사유명', '명칭', '명', 'name'],
        nameAliases: ['취득사유', '취득사유명', '취득사유코드']
    }
};

let rfidConvertState = {
    workbook: null,
    analyzed: null,
    mapping: {},
    defaults: { ...RFID_OAST_DEFAULTS },
    refs: createEmptyRfidRefs(),
    result: null
};

function createEmptyRfidRefs() {
    return {
        deptCode: new Map(),
        ledgerCode: new Map(),
        domesticCode: new Map(),
        countryCode: new Map(),
        acquireReason: new Map(),
        sources: []
    };
}

function rfidNormalizeHeader(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[＊*\s\-_.()[\]（）]/g, '');
}

function rfidHeaderMatchesAlias(header, alias) {
    const h = rfidNormalizeHeader(header);
    const a = rfidNormalizeHeader(alias);
    if (!h || !a) return false;
    return h === a || h.includes(a) || a.includes(h);
}

function rfidCellText(value) {
    if (value == null) return '';
    if (typeof value === 'object') {
        if (value.result != null) return rfidCellText(value.result);
        if (value.text != null) return rfidCellText(value.text);
        if (Array.isArray(value.richText)) {
            return value.richText.map((part) => part.text || '').join('');
        }
    }
    return String(value).trim();
}

function rfidParseNumber(value) {
    const text = rfidCellText(value).replace(/,/g, '');
    if (!text) return '';
    const num = Number(text);
    // 숫자로 못 바꿔도 원본 문자열은 그대로 넣는다
    return Number.isFinite(num) ? num : text;
}

function rfidParseUsefulLife(value) {
    const text = rfidCellText(value);
    if (!text) return '';
    if (text === '미고시') return text;
    const num = Number(String(text).replace(/[^\d.]/g, ''));
    return Number.isFinite(num) && num > 0 ? num : text;
}

function rfidNormalizeGoodsClNo(value) {
    const raw = rfidCellText(value);
    if (!raw) return '';
    if (typeof normalizeGoodsClNo === 'function') {
        return normalizeGoodsClNo(raw) || raw;
    }
    const digits = String(raw).replace(/\D/g, '');
    if (digits.length >= 8) return digits.slice(0, 8);
    return digits || raw;
}

/** M/D/YY, M/D/YYYY, YYYY-MM-DD 등을 YYYY-MM-DD로. 실패 시 원문 유지 */
function rfidParseDate(value) {
    const text = rfidCellText(value);
    if (!text) return '';

    if (typeof parseAcquiredDate === 'function') {
        const parsed = parseAcquiredDate(text);
        if (parsed) return parsed;
    }

    const parts = text.match(/\d+/g) || [];
    if (parts.length >= 3 && parts[0].length === 4) {
        return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
    }
    if (parts.length >= 2 && parts[0].length === 4) {
        return `${parts[0]}-${parts[1].padStart(2, '0')}-01`;
    }
    // 9/8/22, 10/17/2022 (월/일/년)
    if (parts.length >= 3 && parts[0].length <= 2 && parts[1].length <= 2) {
        let year = Number(parts[2]);
        if (parts[2].length <= 2) year += year >= 70 ? 1900 : 2000;
        const month = Number(parts[0]);
        const day = Number(parts[1]);
        if (year >= 1900 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
    }
    return text;
}

function rfidLookupKey(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[\s\-_.()[\]（）/·ㆍ]/g, '');
}

function rfidRefMapSet(map, key, code) {
    const k = rfidLookupKey(key);
    const c = String(code || '').trim();
    if (!k || !c) return;
    if (!map.has(k)) map.set(k, c);
}

function rfidAddInlineRef(map, inlineList) {
    (inlineList || []).forEach((item) => {
        rfidRefMapSet(map, item.code, item.code);
        (item.names || []).forEach((name) => rfidRefMapSet(map, name, item.code));
    });
}

function rfidHeaderAliasScore(header, aliases) {
    const h = rfidNormalizeHeader(header);
    if (!h) return 0;
    let best = 0;
    (aliases || []).forEach((alias) => {
        const a = rfidNormalizeHeader(alias);
        if (!a) return;
        if (h === a) best = Math.max(best, 3);
        else if (h.startsWith(a) || a.startsWith(h)) best = Math.max(best, 2);
        else if (h.includes(a) || a.includes(h)) best = Math.max(best, 1);
    });
    return best;
}

function rfidDetectCodeNameColumns(headerRow, spec) {
    let codeCol = -1;
    let nameCol = -1;
    let codeScore = 0;
    let nameScore = 0;
    (headerRow || []).forEach((cell, idx) => {
        const h = rfidCellText(cell);
        if (!h) return;
        const cs = rfidHeaderAliasScore(h, spec.codeHeaders);
        const ns = rfidHeaderAliasScore(h, spec.nameHeaders);
        if (cs > codeScore) {
            codeScore = cs;
            codeCol = idx;
        }
        if (ns > nameScore) {
            nameScore = ns;
            nameCol = idx;
        }
    });
    // 등재물품 「운영부서(코드)|운영부서」처럼 한 열이 양쪽에 걸리면 코드열을 유지하고 이름열을 다시 고른다
    if (codeCol >= 0 && codeCol === nameCol) {
        nameCol = -1;
        nameScore = 0;
        (headerRow || []).forEach((cell, idx) => {
            if (idx === codeCol) return;
            const ns = rfidHeaderAliasScore(rfidCellText(cell), spec.nameHeaders);
            if (ns > nameScore) {
                nameScore = ns;
                nameCol = idx;
            }
        });
    }
    return { codeCol, nameCol };
}

function rfidIngestPairSheet(map, table, spec) {
    if (!table?.length) return 0;
    let added = 0;
    // 헤더 행 탐색
    let headerIndex = 0;
    let cols = { codeCol: -1, nameCol: -1 };
    for (let i = 0; i < Math.min(table.length, 8); i += 1) {
        const found = rfidDetectCodeNameColumns(table[i], spec);
        if (found.codeCol >= 0 && found.nameCol >= 0) {
            headerIndex = i;
            cols = found;
            break;
        }
    }
    if (cols.codeCol >= 0 && cols.nameCol >= 0) {
        for (let r = headerIndex + 1; r < table.length; r += 1) {
            const code = rfidCellText(table[r]?.[cols.codeCol]);
            const name = rfidCellText(table[r]?.[cols.nameCol]);
            if (!code) continue;
            rfidRefMapSet(map, code, code);
            rfidRefMapSet(map, name, code);
            added += 1;
        }
        return added;
    }
    // 국가코드처럼 코드|명 쌍이 가로로 반복
    const first = (table[0] || []).map(rfidCellText);
    const looksPaired = first.some((h, i) =>
        i % 2 === 0 && rfidHeaderMatchesAlias(h, '국가코드')
    );
    if (looksPaired || spec === RFID_CODE_REF_SPECS.countryCode) {
        for (let r = 1; r < table.length; r += 1) {
            const line = table[r] || [];
            for (let c = 0; c + 1 < line.length; c += 2) {
                const code = rfidCellText(line[c]);
                const name = rfidCellText(line[c + 1]);
                if (!code) continue;
                rfidRefMapSet(map, code, code);
                rfidRefMapSet(map, name, code);
                added += 1;
            }
        }
    }
    return added;
}

function rfidClassifySheetName(sheetName) {
    const n = rfidNormalizeHeader(sheetName);
    for (const [key, spec] of Object.entries(RFID_CODE_REF_SPECS)) {
        if (spec.sheetHints.some((hint) => n.includes(rfidNormalizeHeader(hint)))) {
            return key;
        }
    }
    return '';
}

function mergeRfidReferenceSheet(targetRefs, workbook, sheetName, sourceLabel, forcedKind) {
    if (!workbook?.Sheets?.[sheetName]) return targetRefs;
    const refs = targetRefs || createEmptyRfidRefs();
    const kind = forcedKind && RFID_CODE_REF_SPECS[forcedKind]
        ? forcedKind
        : rfidClassifySheetName(sheetName);
    if (!kind || !RFID_CODE_REF_SPECS[kind]) return refs;
    const table = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
        header: 1,
        defval: '',
        raw: false
    });
    const added = rfidIngestPairSheet(refs[kind], table, RFID_CODE_REF_SPECS[kind]);
    if (added > 0) {
        refs.sources.push(`${sourceLabel}:${sheetName}(${added})`);
    }
    return refs;
}

function mergeRfidReferenceWorkbook(targetRefs, workbook, sourceLabel, options = {}) {
    if (!workbook?.SheetNames?.length) return targetRefs;
    let refs = targetRefs || createEmptyRfidRefs();
    const onlySheet = options.sheetName || '';
    const forcedKind = options.kind || '';
    const names = onlySheet ? [onlySheet] : workbook.SheetNames;
    names.forEach((sheetName) => {
        if (!sheetName || sheetName === RFID_OAST_SHEET) return;
        // 시트 미지정(전체)일 때는 이름 힌트로 코드표만 흡수 — 대용량 대장 시트 제외
        if (!onlySheet && !rfidClassifySheetName(sheetName) && !forcedKind) return;
        refs = mergeRfidReferenceSheet(refs, workbook, sheetName, sourceLabel, forcedKind || '');
    });
    return refs;
}

function seedRfidInlineRefs(refs) {
    const next = refs || createEmptyRfidRefs();
    Object.entries(RFID_CODE_REF_SPECS).forEach(([key, spec]) => {
        if (spec.inline) rfidAddInlineRef(next[key], spec.inline);
    });
    return next;
}

function lookupRfidRefCode(refMap, value) {
    if (!refMap || value == null || value === '') return '';
    const text = rfidCellText(value);
    if (!text) return '';
    const direct = refMap.get(rfidLookupKey(text));
    if (direct) return direct;
    // "0403-취득/자체구입", "6880-산학협력단" 형태
    const parts = text.split(/[-:：_/|]/);
    for (const part of parts) {
        const hit = refMap.get(rfidLookupKey(part));
        if (hit) return hit;
    }
    return '';
}

/**
 * 매핑/이름열/참조표로 코드 결정. 참조 매칭 > 원본 코드 > 기본값
 */
function resolveRfidCodeField(fieldKey, source, mapping, defaults, refs) {
    const spec = RFID_CODE_REF_SPECS[fieldKey];
    const refMap = refs?.[fieldKey];
    const mappedHeader = mapping?.[fieldKey];
    const mappedVal = mappedHeader ? rfidCellText(source[mappedHeader]) : '';
    const aliasVal = rfidLookupByAliases(source, RFID_OAST_FIELDS.find((f) => f.key === fieldKey)?.aliases || []);

    // 1) 이미 코드처럼 보이면 참조표로 검증·정규화
    for (const candidate of [mappedVal, aliasVal]) {
        if (!candidate) continue;
        const fromRef = lookupRfidRefCode(refMap, candidate);
        if (fromRef) return { code: fromRef, via: 'ref' };
        // 참조표에 없어도 숫자/영문 코드면 그대로 사용
        if (/^[0-9A-Za-z]{1,12}$/.test(candidate.trim())) {
            return { code: candidate.trim(), via: 'source-code' };
        }
    }

    // 2) 이름 열(소속·조사부서 등) → 참조표
    if (spec?.nameAliases?.length && refMap?.size) {
        for (const alias of spec.nameAliases) {
            const name = rfidLookupByAliases(source, [alias]);
            if (!name) continue;
            const fromRef = lookupRfidRefCode(refMap, name);
            if (fromRef) return { code: fromRef, via: 'ref-name' };
        }
        // 매핑된 열이 이름인 경우
        if (mappedVal) {
            const fromRef = lookupRfidRefCode(refMap, mappedVal);
            if (fromRef) return { code: fromRef, via: 'ref-mapped-name' };
        }
    }

    // 3) 기본값
    return { code: defaults?.[fieldKey] || RFID_OAST_DEFAULTS[fieldKey] || '', via: 'default' };
}

function describeRfidRefs(refs) {
    if (!refs) return '참조표 없음';
    const counts = Object.keys(RFID_CODE_REF_SPECS).map((key) => {
        const size = refs[key]?.size || 0;
        return size ? `${key.replace('Code', '')}:${size}` : '';
    }).filter(Boolean);
    const src = (refs.sources || []).slice(0, 4).join(', ');
    if (!counts.length) return '참조표 없음 (운영부서 코드표 엑셀을 추가하세요)';
    return `참조 ${counts.join(' · ')}${src ? ` ← ${src}` : ''}`;
}

async function loadRfidOastTemplate() {
    const response = await fetch(RFID_OAST_TEMPLATE_URL, { cache: 'no-cache' });
    if (!response.ok) throw new Error('RFID 양식 템플릿을 불러오지 못했습니다');
    const buffer = await response.arrayBuffer();
    if (typeof XLSX === 'undefined') throw new Error('SheetJS가 필요합니다');
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true, raw: false });
    if (!workbook.SheetNames.includes(RFID_OAST_SHEET)) {
        throw new Error(`템플릿에 "${RFID_OAST_SHEET}" 시트가 없습니다`);
    }
    const sheet = workbook.Sheets[RFID_OAST_SHEET];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
    const header = rows[RFID_OAST_HEADER_ROW] || [];
    const filled = header.map(rfidCellText).filter(Boolean);
    if (filled.length < 10) throw new Error('템플릿 8행 헤더를 읽지 못했습니다');
    return workbook;
}

function readRfidRefSheetOptionsFromUi() {
    const sheetSelect = document.getElementById('rfidRefSheetSelect');
    const kindSelect = document.getElementById('rfidRefKindSelect');
    return {
        sheetName: sheetSelect?.value || '',
        kind: kindSelect?.value === 'auto' ? '' : (kindSelect?.value || '')
    };
}

function populateRfidRefSheetSelect(workbook, preferredSheet) {
    const select = document.getElementById('rfidRefSheetSelect');
    if (!select) return;
    const names = workbook?.SheetNames || [];
    if (!names.length) {
        select.innerHTML = '<option value=\"\">시트가 없습니다</option>';
        select.disabled = true;
        return;
    }
    const preferred = preferredSheet
        || names.find((n) => rfidClassifySheetName(n) === 'deptCode')
        || names.find((n) => rfidNormalizeHeader(n).includes('운영부서'))
        || names[0];
    select.innerHTML = names.map((name) => {
        const kind = rfidClassifySheetName(name);
        const tag = kind ? ` (${kind})` : '';
        const sel = name === preferred ? ' selected' : '';
        return `<option value=\"${String(name).replace(/\"/g, '&quot;')}\"${sel}>${name}${tag}</option>`;
    }).join('');
    select.disabled = false;
    const kindSelect = document.getElementById('rfidRefKindSelect');
    if (kindSelect && preferred) {
        const detected = rfidClassifySheetName(preferred);
        kindSelect.value = detected || 'deptCode';
    }
}

async function rebuildRfidRefs(extraWorkbook, extraLabel) {
    let refs = seedRfidInlineRefs(createEmptyRfidRefs());
    try {
        const template = await loadRfidOastTemplate();
        refs = mergeRfidReferenceWorkbook(refs, template, '템플릿');
    } catch (error) {
        console.warn('템플릿 참조표 로드 실패:', error);
    }
    // 앱 기본 운영부서 양식(등재물품 「운영부서」시트 형식)
    try {
        const deptTpl = await fetch('templates/RFID_운영부서코드_양식.xlsx', { cache: 'no-cache' });
        if (deptTpl.ok) {
            const buf = await deptTpl.arrayBuffer();
            const deptWb = XLSX.read(buf, { type: 'array', raw: false });
            refs = mergeRfidReferenceWorkbook(refs, deptWb, '기본운영부서', {
                sheetName: deptWb.SheetNames.includes('운영부서') ? '운영부서' : deptWb.SheetNames[0],
                kind: 'deptCode'
            });
        }
    } catch (error) {
        console.warn('기본 운영부서 코드표 로드 실패:', error);
    }
    if (rfidConvertState.sourceWorkbook) {
        refs = mergeRfidReferenceWorkbook(refs, rfidConvertState.sourceWorkbook, '원본');
    }
    const extra = extraWorkbook || rfidConvertState.extraRefWorkbook;
    const label = extraLabel || rfidConvertState.extraRefLabel || '추가';
    if (extra) {
        const opts = readRfidRefSheetOptionsFromUi();
        const sheetName = opts.sheetName || extra.SheetNames.find((n) => rfidClassifySheetName(n)) || extra.SheetNames[0];
        refs = mergeRfidReferenceWorkbook(refs, extra, label, {
            sheetName,
            kind: opts.kind || rfidClassifySheetName(sheetName) || 'deptCode'
        });
    }
    rfidConvertState.refs = refs;
    const status = document.getElementById('rfidRefStatus');
    if (status) status.textContent = describeRfidRefs(refs);
    return refs;
}

function analyzeSourceForRfid(arrayBuffer, preferredSheet) {
    if (typeof XLSX === 'undefined') throw new Error('SheetJS가 필요합니다');
    const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true, raw: false });
    if (typeof analyzeRegisterSheet === 'function') {
        return analyzeRegisterSheet(workbook, preferredSheet);
    }
    // register.js 미로드 시 최소 폴백: 첫 시트·가장 긴 헤더 행
    const sheetName = preferredSheet || workbook.SheetNames[0];
    const table = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
        header: 1,
        defval: '',
        raw: false
    });
    let headerIndex = 0;
    let best = -1;
    for (let i = 0; i < Math.min(table.length, 40); i += 1) {
        const score = (table[i] || []).filter((c) => rfidCellText(c)).length;
        if (score > best) {
            best = score;
            headerIndex = i;
        }
    }
    const headers = (table[headerIndex] || []).map((c, i) => rfidCellText(c) || `열${i + 1}`);
    const rows = table.slice(headerIndex + 1).map((line) => {
        const row = {};
        headers.forEach((h, i) => {
            row[h] = rfidCellText(line?.[i]);
        });
        return row;
    }).filter((row) => Object.values(row).some(Boolean));
    return {
        sheetName,
        headerIndex,
        headers,
        rows,
        sheets: [{ name: sheetName, rows: rows.length, headerIndex }],
        analyses: [{ sheetName, headerIndex, headers, rows, score: rows.length }]
    };
}

function suggestRfidMapping(headers) {
    const mapping = {};
    const used = new Set();
    const priority = {
        assetId: ['물품식별번호', '식별번호', '자산번호', 'rfid번호'],
        itemName: ['자산명', '품목명', '물품명'],
        goodsClNm: ['품명', '분류명'],
        goodsClNo: ['물품분류번호', '분류번호'],
        amount: ['취득가액', '금액']
    };

    RFID_OAST_FIELDS.forEach((field) => {
        const preferred = priority[field.key] || field.aliases;
        for (const alias of preferred) {
            const hit = headers.find((h) => !used.has(h) && rfidHeaderMatchesAlias(h, alias));
            if (hit) {
                mapping[field.key] = hit;
                used.add(hit);
                return;
            }
        }
        for (const alias of field.aliases) {
            const hit = headers.find((h) => !used.has(h) && rfidHeaderMatchesAlias(h, alias));
            if (hit) {
                mapping[field.key] = hit;
                used.add(hit);
                return;
            }
        }
    });
    return mapping;
}

function rfidLookupByAliases(source, aliases) {
    for (const alias of aliases) {
        for (const [header, value] of Object.entries(source || {})) {
            if (!rfidHeaderMatchesAlias(header, alias)) continue;
            const text = rfidCellText(value);
            if (text) return text;
        }
    }
    return '';
}

function rfidNameKey(value) {
    if (typeof goodsCatalogNormalize === 'function') return goodsCatalogNormalize(value);
    if (typeof normalizeGoodsName === 'function') return normalizeGoodsName(value);
    return rfidNormalizeHeader(value);
}

/** 현장 표기 → 목록정보 대표 품명 (후보 1개만 — 여러 분류로 갈리면 자동 채우지 않음) */
const RFID_NAME_SYNONYMS = {
    tv: ['텔레비전'],
    '스마트tv': ['텔레비전'],
    '이동식스마트tv': ['텔레비전'],
    '티브이': ['텔레비전'],
    '티비': ['텔레비전'],
    '엘시디모니터': ['LCD패널또는모니터'],
    'lcd모니터': ['LCD패널또는모니터'],
    '액정모니터': ['LCD패널또는모니터'],
    '인퓨젼펌프': ['범용정맥주입펌프'],
    '인퓨전펌프': ['범용정맥주입펌프']
};

/** 자산명·목록정보 품명이 같은 계열인지 (포함/공통접두) */
function rfidNamesRelated(a, b) {
    const ka = rfidNameKey(a);
    const kb = rfidNameKey(b);
    if (!ka || !kb) return false;
    if (ka === kb) return true;
    if (ka.length >= 2 && kb.length >= 2 && (ka.includes(kb) || kb.includes(ka))) return true;
    let i = 0;
    while (i < ka.length && i < kb.length && ka[i] === kb[i]) i += 1;
    return i >= 4;
}

/**
 * 대장 자산명에서 목록정보 조회용 핵심명 후보.
 * "액체크로마토그래피, Shimadzu, ..." → "액체크로마토그래피"
 */
function rfidItemNameCandidates(itemName) {
    const raw = String(itemName || '').trim();
    if (!raw) return [];
    const out = [];
    const push = (value) => {
        const text = String(value || '').replace(/\s+/g, ' ').trim();
        if (text.length < 2) return;
        if (!out.some((x) => rfidNameKey(x) === rfidNameKey(text))) out.push(text);
    };

    push(raw);
    // 흔한 맞춤법 요동 (젼/전)
    if (/젼/.test(raw)) push(raw.replace(/젼/g, '전'));
    if (/전/.test(raw) && !/젼/.test(raw)) push(raw.replace(/전(?=펌프|컴퓨터|모니터)/g, '젼'));

    const noParen = raw.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ');
    push(noParen);

    const beforeComma = raw.split(/[,，、]/)[0];
    push(beforeComma);
    push(beforeComma.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' '));

    // 수식어 제거 후 본체
    const stripped = String(beforeComma || raw)
        .replace(/^(이동식|휴대용|무선|고정식|탁상형|벽걸이|일체형|산업용|상업용|의료용)\s*/u, '')
        .trim();
    push(stripped);
    if (/젼/.test(stripped)) push(stripped.replace(/젼/g, '전'));

    // 동의어 확장
    const keysToExpand = [raw, beforeComma, stripped]
        .map((v) => rfidNameKey(v))
        .filter(Boolean);
    keysToExpand.forEach((key) => {
        (RFID_NAME_SYNONYMS[key] || []).forEach((syn) => push(syn));
    });

    // 내용연수 쪽 토큰 확장이 있으면 후보만 추가(확정은 아래 안전 검증)
    if (typeof expandUsefulLifeKeys === 'function') {
        expandUsefulLifeKeys(stripped || beforeComma || raw).slice(0, 8).forEach((key) => {
            if (key && key.length >= 2) push(key);
        });
    }

    return out.slice(0, 16);
}

/**
 * 이름 매칭 안전성.
 * - 자산명이 목록정보 분류명(또는 영문명)과 같거나 포함관계일 때만 자동 채움
 * - 세부품명만 같고 분류명과 무관한 별칭(블랙박스→비행자료기록장치)은 제외
 */
function rfidNameMatchIsSafe(itemName, entry) {
    if (!entry?.goodsClNo || !itemName) return false;
    if (rfidNamesRelated(itemName, entry.goodsClNm)) return true;
    if (rfidNamesRelated(itemName, entry.engNm)) return true;
    // 세부품명 정확 일치이면서 그 세부품명이 분류명과 같은 계열일 때만 허용
    const key = rfidNameKey(itemName);
    const relatedDetail = (entry.details || []).some((d) => {
        const detailKey = rfidNameKey(d.goodsClDetailNm);
        const engKey = rfidNameKey(d.engNm);
        if (detailKey !== key && engKey !== key) return false;
        return rfidNamesRelated(d.goodsClDetailNm || d.engNm, entry.goodsClNm)
            || rfidNamesRelated(d.engNm, entry.engNm);
    });
    if (relatedDetail) return true;
    if (typeof searchGoodsCatalog === 'function') {
        const exactHits = searchGoodsCatalog(itemName, 5, { mode: 'exact' }) || [];
        if (
            exactHits.length === 1
            && exactHits[0].goodsClNo === entry.goodsClNo
            && rfidNameKey(exactHits[0].goodsClNm) === rfidNameKey(itemName)
        ) {
            return true;
        }
    }
    return false;
}

/** 목록정보 조회용 코드 후보 (세부품명번호·10자리 식별만). 긴 자산번호 제외 */
function rfidCatalogCodeCandidates(source, mapping, assetId, goodsClNo) {
    const out = [];
    const push = (value, role) => {
        const digits = String(value || '').replace(/\D/g, '');
        if (!digits || digits.length > 12) return;
        out.push({ digits, role });
    };
    push(rfidLookupByAliases(source, ['세부품명번호', '세부품명코드']), 'detail');
    const mappedDetail = mapping?.goodsClNo && String(source[mapping.goodsClNo] || '');
    // 분류번호 열은 class로
    push(goodsClNo, 'class');
    const ident = rfidLookupByAliases(source, ['식별번호', '물품식별번호']);
    const identDigits = String(ident || '').replace(/\D/g, '');
    if (identDigits.length === 10) push(identDigits, 'detail');
    // 매핑된 assetId가 10자리 세부품명 형식일 때만 목록정보 키로 사용
    const assetDigits = String(assetId || '').replace(/\D/g, '');
    if (assetDigits.length === 10) push(assetDigits, 'detail');
    else if (assetDigits.length === 8 && assetDigits === identDigits) {
        // 기관 8자리 식별 — 목록정보 분류코드와 우연히 같으면 위험하므로 이름 검증 전제 class만 시도
        push(assetDigits, 'maybe-class');
    }
    if (mappedDetail) push(mappedDetail, 'class');
    return out;
}

/** 행에서 품목 식별번호(8자리) 후보 수집 */
function rfidCollectIdntfcNos(sourceRows, mapping) {
    const out = [];
    (sourceRows || []).forEach((source) => {
        const mapped = mapping?.assetId ? rfidCellText(source[mapping.assetId]) : '';
        const alias = rfidLookupByAliases(source, ['물품식별번호', '식별번호']);
        [mapped, alias].forEach((value) => {
            const digits = String(value || '').replace(/\D/g, '');
            if (digits.length === 8) out.push(digits);
        });
    });
    return out;
}

/**
 * 목록정보 매칭 —
 * 0) 품목 식별번호(8) 품목검색 캐시
 * 1) 세부품명번호(10) → 분류
 * 2) 원본 분류번호
 * 3) 이름(안전)
 */
function rfidResolveCatalogMatch({ assetId, goodsClNo, goodsClNm, itemName, source, mapping }, cache) {
    const classDigits = String(goodsClNo || '').replace(/\D/g, '');
    const cacheKey = [
        String(assetId || ''),
        classDigits,
        rfidNameKey(itemName),
        rfidNameKey(goodsClNm),
        rfidLookupByAliases(source || {}, ['세부품명번호', '식별번호'])
    ].join('|');
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    let result = null;
    const candidates = rfidCatalogCodeCandidates(source, mapping, assetId, goodsClNo);

    // 0) 품목 식별번호(8자리) — 나라장터 품목검색 캐시
    if (typeof lookupGoodsIdntfcNo === 'function') {
        const idCandidates = [
            assetId,
            rfidLookupByAliases(source || {}, ['물품식별번호', '식별번호'])
        ];
        for (const raw of idCandidates) {
            const byIdent = lookupGoodsIdntfcNo(raw);
            if (!byIdent?.goodsClNo) continue;
            let classNm = byIdent.goodsClNm || '';
            if (!classNm && typeof lookupGoodsCatalogByCode === 'function') {
                classNm = lookupGoodsCatalogByCode(byIdent.goodsClNo)?.goodsClNm || '';
            }
            result = {
                goodsClNo: byIdent.goodsClNo,
                goodsClNm: classNm,
                goodsClDetailNo: byIdent.goodsClDetailNo || '',
                via: 'idntfc-no',
                entry: byIdent,
                preferDetailId: false
            };
            break;
        }
    }

    // 1) 세부품명번호(10자리) 우선
    if (!result && typeof resolveGoodsCatalogByAnyCode === 'function') {
        for (const cand of candidates) {
            if (cand.role !== 'detail') continue;
            const byId = resolveGoodsCatalogByAnyCode(cand.digits, { allowClassNo: false });
            if (byId?.goodsClNo) {
                result = {
                    goodsClNo: byId.goodsClNo,
                    goodsClNm: byId.goodsClNm || '',
                    goodsClDetailNo: byId.goodsClDetailNo || cand.digits,
                    via: byId.via || 'detail-id',
                    entry: byId.entry || null,
                    preferDetailId: false
                };
                break;
            }
        }
    }

    // 2) 원본 분류번호로 품명 보강
    if (!result && classDigits.length === 8 && typeof resolveGoodsCatalogByAnyCode === 'function') {
        const byClass = resolveGoodsCatalogByAnyCode(classDigits, { allowClassNo: true });
        if (byClass?.goodsClNo) {
            result = {
                goodsClNo: byClass.goodsClNo,
                goodsClNm: byClass.goodsClNm || '',
                goodsClDetailNo: '',
                via: 'class-no',
                entry: byClass.entry || null,
                preferDetailId: false
            };
        }
    }

    // 3) 이름 매칭 — 핵심명/동의어 후보마다 유일+안전 검증
    if (!result) {
        const names = [];
        rfidItemNameCandidates(itemName).forEach((n) => names.push(n));
        rfidItemNameCandidates(goodsClNm).forEach((n) => {
            if (!names.some((x) => rfidNameKey(x) === rfidNameKey(n))) names.push(n);
        });
        for (const name of names) {
            let entry = null;
            if (typeof lookupGoodsCatalogByName === 'function') {
                const hit = lookupGoodsCatalogByName(name);
                if (hit.entry?.goodsClNo) entry = hit.entry;
                else if (hit.candidates?.length === 1) entry = hit.candidates[0];
            }
            if (!entry && typeof suggestGoodsCatalogForMatch === 'function') {
                const suggestions = suggestGoodsCatalogForMatch(name, 5);
                if (suggestions.length === 1) entry = suggestions[0];
            }
            if (!entry?.goodsClNo) continue;
            if (!rfidNameMatchIsSafe(name, entry)) continue;

            let detailNo = '';
            const key = rfidNameKey(name);
            const detailHits = (entry.details || []).filter((d) =>
                rfidNameKey(d.goodsClDetailNm) === key || rfidNameKey(d.engNm) === key
            );
            if (detailHits.length === 1) {
                detailNo = String(detailHits[0].goodsClDetailNo || '').replace(/\D/g, '');
            } else if (entry.details?.length === 1) {
                detailNo = String(entry.details[0].goodsClDetailNo || '').replace(/\D/g, '');
            }
            result = {
                goodsClNo: entry.goodsClNo,
                goodsClNm: entry.goodsClNm || '',
                goodsClDetailNo: detailNo,
                via: 'catalog-name-safe',
                entry,
                preferDetailId: false
            };
            break;
        }
    }

    cache.set(cacheKey, result);
    return result;
}

async function ensureRfidMatchSources(options = {}) {
    const tasks = [];
    if (typeof ensureGoodsCatalog === 'function') tasks.push(ensureGoodsCatalog());
    if (typeof ensureUsefulLifeTable === 'function') tasks.push(ensureUsefulLifeTable());
    if (typeof ensureGoodsIdntfcCache === 'function') tasks.push(ensureGoodsIdntfcCache());
    if (tasks.length) await Promise.all(tasks);

    const rows = options.rows || rfidConvertState.analyzed?.rows || [];
    const mapping = options.mapping || rfidConvertState.mapping || {};
    if (typeof prefetchGoodsIdntfcNos === 'function' && rows.length) {
        const ids = rfidCollectIdntfcNos(rows, mapping);
        if (ids.length) {
            await prefetchGoodsIdntfcNos(ids, {
                onProgress: options.onIdntfcProgress
            });
        }
    }
}

/**
 * @param {object} [options]
 * @param {boolean} [options.autoCatalog=true] 빈 분류/식별을 목록정보로 채움
 */
function transformRfidRows(sourceRows, mapping, defaults = RFID_OAST_DEFAULTS, options = {}) {
    const autoCatalog = options.autoCatalog !== false;
    const emptyRequired = [];
    const refs = options.refs || rfidConvertState.refs || createEmptyRfidRefs();
    const stats = {
        classFilled: 0,
        classCorrected: 0,
        idFilledFromSource: 0,
        idFilledFromCatalog: 0,
        stillEmptyClass: 0,
        stillEmptyId: 0,
        codeFromRef: 0,
        codeFromDefault: 0
    };
    const classCache = new Map();

    const dataRows = sourceRows.map((source, index) => {
        const get = (key) => {
            const header = mapping[key];
            return header ? rfidCellText(source[header]) : '';
        };

        let goodsClNo = rfidNormalizeGoodsClNo(get('goodsClNo') || rfidLookupByAliases(source, RFID_OAST_FIELDS[0].aliases));
        let goodsClNm = get('goodsClNm') || rfidLookupByAliases(source, RFID_OAST_FIELDS[1].aliases);
        let assetId = get('assetId') || rfidLookupByAliases(source, RFID_OAST_FIELDS[2].aliases);
        const itemName = get('itemName') || rfidLookupByAliases(source, RFID_OAST_FIELDS[3].aliases);
        const sourceHadClass = Boolean(goodsClNo);
        const sourceHadId = Boolean(assetId);

        if (assetId) stats.idFilledFromSource += 1;

        if (autoCatalog) {
            const catalogHit = rfidResolveCatalogMatch({
                assetId,
                goodsClNo,
                goodsClNm,
                itemName,
                source,
                mapping
            }, classCache);

            if (catalogHit) {
                // 세부품명번호로 확정된 분류만 원본 분류를 덮어씀
                const idDriven = catalogHit.via === 'detail-no'
                    || catalogHit.via === 'detail-prefix-class'
                    || catalogHit.via === 'detail-id'
                    || catalogHit.via === 'idntfc-no';
                if (catalogHit.goodsClNo && (!sourceHadClass || idDriven)) {
                    if (goodsClNo !== catalogHit.goodsClNo) {
                        if (!sourceHadClass) stats.classFilled += 1;
                        else stats.classCorrected = (stats.classCorrected || 0) + 1;
                    }
                    goodsClNo = catalogHit.goodsClNo;
                }
                // 품명(목록정보 분류명) — 비었거나 식별/세부품명 확정·안전 이름매칭일 때 채움
                if (catalogHit.goodsClNm) {
                    if (!goodsClNm || idDriven || catalogHit.via === 'catalog-name-safe' || catalogHit.via === 'class-no') {
                        goodsClNm = catalogHit.goodsClNm;
                    }
                }
                // 기관 식별/자산번호가 없을 때만 세부품명번호로 식별 칸 보충 (덮어쓰지 않음)
                if (!sourceHadId && catalogHit.goodsClDetailNo && String(catalogHit.goodsClDetailNo).length === 10) {
                    assetId = catalogHit.goodsClDetailNo;
                    stats.idFilledFromCatalog += 1;
                }
            }
        }

        if (!goodsClNo) stats.stillEmptyClass += 1;
        if (!assetId) stats.stillEmptyId += 1;

        const codeResolved = {};
        ['deptCode', 'ledgerCode', 'domesticCode', 'countryCode', 'acquireReason'].forEach((key) => {
            const hit = resolveRfidCodeField(key, source, mapping, defaults, refs);
            codeResolved[key] = hit.code;
            if (hit.via === 'ref' || hit.via === 'ref-name' || hit.via === 'ref-mapped-name') {
                stats.codeFromRef += 1;
            } else if (hit.via === 'default') {
                stats.codeFromDefault += 1;
            }
        });

        const row = RFID_OAST_FIELDS.map((field) => {
            let raw = get(field.key);
            if (!raw && (field.key === 'assetId' || field.key === 'goodsClNo' || field.key === 'itemName' || field.key === 'goodsClNm')) {
                raw = rfidLookupByAliases(source, field.aliases);
            }
            switch (field.key) {
                case 'goodsClNo':
                    return goodsClNo || rfidNormalizeGoodsClNo(raw);
                case 'goodsClNm':
                    return goodsClNm || raw;
                case 'assetId':
                    return assetId || raw;
                case 'itemName':
                    return itemName || raw;
                case 'acquiredAt':
                case 'leaseStart':
                case 'leaseEnd':
                    return rfidParseDate(raw);
                case 'quantity':
                case 'unitPrice':
                case 'amount':
                case 'bookValue':
                case 'depreciation':
                case 'leasePrice':
                    return rfidParseNumber(raw);
                case 'usefulLife':
                    return rfidParseUsefulLife(raw);
                case 'deptCode':
                case 'ledgerCode':
                case 'domesticCode':
                case 'countryCode':
                case 'acquireReason':
                    return codeResolved[field.key] || raw || defaults[field.key];
                default:
                    return raw;
            }
        });

        const missing = RFID_OAST_FIELDS
            .filter((field, i) => field.required && (row[i] === '' || row[i] == null))
            .map((field) => field.label);
        if (missing.length) {
            emptyRequired.push({ row: index + 1, missing });
        }
        return row;
    });

    return { dataRows, emptyRequired, warnings: emptyRequired, stats };
}

function clearSheetDataFromRow(sheet, startRow0) {
    const ref = sheet['!ref'];
    if (!ref) return;
    const range = XLSX.utils.decode_range(ref);
    for (let R = startRow0; R <= range.e.r; R += 1) {
        for (let C = range.s.c; C <= range.e.c; C += 1) {
            const addr = XLSX.utils.encode_cell({ r: R, c: C });
            if (sheet[addr]) delete sheet[addr];
        }
    }
    range.e.r = Math.max(startRow0 - 1, range.s.r);
    sheet['!ref'] = XLSX.utils.encode_range(range);
}

function buildRfidWorkbook(templateWb, dataRows) {
    const workbook = XLSX.utils.book_new();
    templateWb.SheetNames.forEach((name) => {
        const src = templateWb.Sheets[name];
        const clone = XLSX.utils.aoa_to_sheet(
            XLSX.utils.sheet_to_json(src, { header: 1, defval: '', raw: false })
        );
        if (src['!merges']) clone['!merges'] = src['!merges'].map((m) => ({ ...m }));
        if (src['!cols']) clone['!cols'] = src['!cols'].slice();
        XLSX.utils.book_append_sheet(workbook, clone, name);
    });

    const sheet = workbook.Sheets[RFID_OAST_SHEET];
    clearSheetDataFromRow(sheet, RFID_OAST_DATA_START);
    XLSX.utils.sheet_add_aoa(sheet, dataRows, { origin: { r: RFID_OAST_DATA_START, c: 0 } });
    return workbook;
}

function downloadRfidWorkbook(workbook, filename) {
    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, filename || `RFID_취득재산일괄등록_변환_${stamp}.xlsx`);
}

function readRfidDefaultsFromUi() {
    return {
        deptCode: document.getElementById('rfidDefaultDept')?.value?.trim() || RFID_OAST_DEFAULTS.deptCode,
        ledgerCode: document.getElementById('rfidDefaultLedger')?.value?.trim() || RFID_OAST_DEFAULTS.ledgerCode,
        domesticCode: document.getElementById('rfidDefaultDomestic')?.value?.trim() || RFID_OAST_DEFAULTS.domesticCode,
        countryCode: document.getElementById('rfidDefaultCountry')?.value?.trim() || RFID_OAST_DEFAULTS.countryCode,
        acquireReason: document.getElementById('rfidDefaultReason')?.value?.trim() || RFID_OAST_DEFAULTS.acquireReason
    };
}

function readRfidAutoCatalogFromUi() {
    const el = document.getElementById('rfidAutoCatalog');
    return el ? el.checked !== false : true;
}

function renderRfidSheetOptions(analyzed) {
    const select = document.getElementById('rfidSourceSheet');
    if (!select || !analyzed?.sheets) return;
    select.innerHTML = analyzed.sheets.map((sheet) =>
        `<option value="${sheet.name}" ${sheet.name === analyzed.sheetName ? 'selected' : ''}>`
        + `${sheet.name} (${sheet.rows}행 · 헤더 ${sheet.headerIndex + 1}행)</option>`
    ).join('');
}

function renderRfidMappingFields(headers, mapping) {
    const box = document.getElementById('rfidMapFields');
    if (!box) return;

    box.innerHTML = RFID_OAST_FIELDS.map((field) => {
        const selected = mapping[field.key] || '';
        const optionHtml = ['<option value="">— 매핑 안 함 / 기본값 —</option>']
            .concat(headers.map((h) => {
                const sel = h === selected ? ' selected' : '';
                return `<option value="${String(h).replace(/"/g, '&quot;')}"${sel}>${h}</option>`;
            }))
            .join('');
        const req = field.required ? ' <span class="rfid-req">필수</span>' : '';
        return `<label class="rfid-map-row">
            <span class="rfid-map-label">${field.label}${req}</span>
            <select data-rfid-field="${field.key}">${optionHtml}</select>
        </label>`;
    }).join('');

    box.querySelectorAll('select[data-rfid-field]').forEach((select) => {
        select.addEventListener('change', () => {
            rfidConvertState.mapping[select.dataset.rfidField] = select.value || '';
            refreshRfidPreview();
        });
    });
}

function readRfidMappingFromUi() {
    const mapping = {};
    document.querySelectorAll('#rfidMapFields select[data-rfid-field]').forEach((select) => {
        if (select.value) mapping[select.dataset.rfidField] = select.value;
    });
    return mapping;
}

async function refreshRfidPreview() {
    const preview = document.getElementById('rfidPreview');
    const warnEl = document.getElementById('rfidConvertWarn');
    const convertBtn = document.getElementById('rfidConvertDownloadBtn');
    if (!rfidConvertState.analyzed?.rows?.length) {
        if (preview) preview.innerHTML = '';
        if (warnEl) warnEl.textContent = '';
        if (convertBtn) convertBtn.disabled = true;
        return;
    }

    rfidConvertState.defaults = readRfidDefaultsFromUi();
    rfidConvertState.mapping = readRfidMappingFromUi();

    if (readRfidAutoCatalogFromUi()) {
        if (warnEl) warnEl.textContent = '목록정보·식별번호 조회 준비 중…';
        await ensureRfidMatchSources({
            rows: rfidConvertState.analyzed.rows,
            mapping: rfidConvertState.mapping,
            onIdntfcProgress: (done, total) => {
                if (warnEl) warnEl.textContent = `식별번호 목록정보 조회 ${done}/${total}…`;
            }
        });
    }
    if (!rfidConvertState.refs?.sources?.length) {
        await rebuildRfidRefs();
    }

    const { dataRows, emptyRequired, stats } = transformRfidRows(
        rfidConvertState.analyzed.rows,
        rfidConvertState.mapping,
        rfidConvertState.defaults,
        {
            autoCatalog: readRfidAutoCatalogFromUi(),
            refs: rfidConvertState.refs
        }
    );
    rfidConvertState.result = { dataRows, emptyRequired, warnings: emptyRequired, stats };

    if (warnEl) {
        const parts = [`변환 대상 ${dataRows.length}행`];
        if (stats?.classFilled) parts.push(`분류번호 자동 ${stats.classFilled}`);
        if (stats?.classCorrected) parts.push(`분류번호 보정 ${stats.classCorrected}`);
        if (stats?.idFilledFromCatalog) parts.push(`식별(세부품명) 자동 ${stats.idFilledFromCatalog}`);
        if (stats?.codeFromRef) parts.push(`코드 참조매칭 ${stats.codeFromRef}`);
        if (emptyRequired.length) {
            parts.push(`빈 필수칸 행 ${emptyRequired.length}건도 그대로 포함`);
        }
        if (stats?.stillEmptyClass || stats?.stillEmptyId) {
            parts.push(`미확정 분류 ${stats.stillEmptyClass || 0} / 식별 ${stats.stillEmptyId || 0}`);
        }
        warnEl.textContent = parts.join(' · ');
        warnEl.classList.remove('rfid-warn-bad');
        warnEl.classList.add('rfid-warn-ok');
    }

    if (preview) {
        const head = RFID_OAST_FIELDS.slice(0, 8).map((f) => `<th>${f.label.replace(/＊/g, '')}</th>`).join('');
        const body = dataRows.slice(0, 20).map((row) =>
            `<tr>${row.slice(0, 8).map((c) => `<td>${c === '' || c == null ? '' : c}</td>`).join('')}</tr>`
        ).join('');
        preview.innerHTML = `<div class="rfid-preview-scroll"><table class="rfid-preview-table">
            <thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
            <p class="rfid-preview-note">미리보기 상위 ${Math.min(20, dataRows.length)}행 · 앞 8열</p>`;
    }

    if (convertBtn) convertBtn.disabled = dataRows.length === 0;
}

async function handleRfidSourceFile(file) {
    if (!file) return;
    const panel = document.getElementById('rfidConvertPanel');
    if (panel) panel.hidden = false;
    const status = document.getElementById('rfidConvertStatus');
    if (status) status.textContent = '원본 분석 중…';

    try {
        const buffer = await file.arrayBuffer();
        const sourceWb = XLSX.read(buffer, { type: 'array', cellDates: true, raw: false });
        rfidConvertState.sourceWorkbook = sourceWb;
        const analyzed = analyzeSourceForRfid(buffer);
        rfidConvertState.workbook = null;
        rfidConvertState.analyzed = analyzed;
        rfidConvertState.mapping = suggestRfidMapping(analyzed.headers);
        await rebuildRfidRefs();
        renderRfidSheetOptions(analyzed);
        renderRfidMappingFields(analyzed.headers, rfidConvertState.mapping);
        await refreshRfidPreview();
        if (status) {
            status.textContent = `"${analyzed.sheetName}" · 헤더 ${analyzed.headerIndex + 1}행 · 데이터 ${analyzed.rows.length}행`;
        }
        if (typeof showToast === 'function') {
            showToast(`원본 ${analyzed.rows.length}행 분석 완료`, 'success');
        }
    } catch (error) {
        console.error(error);
        if (status) status.textContent = error.message || '분석 실패';
        if (typeof showToast === 'function') showToast(error.message || '분석 실패', 'error');
    }
}

async function handleRfidSheetChange() {
    const select = document.getElementById('rfidSourceSheet');
    const fileInput = document.getElementById('rfidSourceFile');
    const file = fileInput?.files?.[0];
    if (!file || !select?.value) return;
    const buffer = await file.arrayBuffer();
    rfidConvertState.sourceWorkbook = XLSX.read(buffer, { type: 'array', cellDates: true, raw: false });
    const analyzed = analyzeSourceForRfid(buffer, select.value);
    rfidConvertState.analyzed = analyzed;
    rfidConvertState.mapping = suggestRfidMapping(analyzed.headers);
    await rebuildRfidRefs();
    renderRfidMappingFields(analyzed.headers, rfidConvertState.mapping);
    await refreshRfidPreview();
    const status = document.getElementById('rfidConvertStatus');
    if (status) {
        status.textContent = `"${analyzed.sheetName}" · 헤더 ${analyzed.headerIndex + 1}행 · 데이터 ${analyzed.rows.length}행`;
    }
}

async function handleRfidConvertDownload() {
    if (!rfidConvertState.analyzed?.rows?.length) return;
    const btn = document.getElementById('rfidConvertDownloadBtn');
    if (btn) btn.disabled = true;
    try {
        const autoCatalog = readRfidAutoCatalogFromUi();
        rfidConvertState.defaults = readRfidDefaultsFromUi();
        rfidConvertState.mapping = readRfidMappingFromUi();
        if (autoCatalog) {
            await ensureRfidMatchSources({
                rows: rfidConvertState.analyzed.rows,
                mapping: rfidConvertState.mapping
            });
        }
        await rebuildRfidRefs();
        const { dataRows, stats } = transformRfidRows(
            rfidConvertState.analyzed.rows,
            rfidConvertState.mapping,
            rfidConvertState.defaults,
            { autoCatalog, refs: rfidConvertState.refs }
        );
        const template = await loadRfidOastTemplate();
        const out = buildRfidWorkbook(template, dataRows);
        downloadRfidWorkbook(out);
        if (typeof showToast === 'function') {
            const extra = stats?.classFilled || stats?.idFilledFromCatalog
                ? ` (분류 자동 ${stats.classFilled || 0}, 식별 자동 ${stats.idFilledFromCatalog || 0})`
                : '';
            showToast(`${dataRows.length}행 변환 완료${extra}`, 'success');
        }
    } catch (error) {
        console.error(error);
        if (typeof showToast === 'function') showToast(error.message || '변환 실패', 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function handleRfidRefFile(file) {
    if (!file) return;
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array', cellDates: true, raw: false });
    rfidConvertState.extraRefWorkbook = wb;
    rfidConvertState.extraRefLabel = file.name;
    populateRfidRefSheetSelect(wb);
    const panel = document.getElementById('rfidRefSheetPanel');
    if (panel) panel.hidden = false;
    await rebuildRfidRefs(wb, file.name);
    await refreshRfidPreview();
    if (typeof showToast === 'function') {
        const sheet = document.getElementById('rfidRefSheetSelect')?.value || '';
        showToast(`참조 반영: ${file.name}${sheet ? ` / ${sheet}` : ''}`, 'success');
    }
}

async function handleRfidRefSheetOrKindChange() {
    if (!rfidConvertState.extraRefWorkbook) return;
    await rebuildRfidRefs();
    await refreshRfidPreview();
}

function bindRfidFormConvertUi() {
    const pickBtn = document.getElementById('rfidSourcePickBtn');
    const fileInput = document.getElementById('rfidSourceFile');
    const sheetSelect = document.getElementById('rfidSourceSheet');
    const downloadBtn = document.getElementById('rfidConvertDownloadBtn');
    const refPickBtn = document.getElementById('rfidRefPickBtn');
    const refFile = document.getElementById('rfidRefFile');
    const refSheetSelect = document.getElementById('rfidRefSheetSelect');
    const refKindSelect = document.getElementById('rfidRefKindSelect');
    const refTemplateBtn = document.getElementById('rfidRefTemplateBtn');

    if (pickBtn && fileInput) {
        pickBtn.addEventListener('click', () => fileInput.click());
    }
    if (fileInput) {
        fileInput.addEventListener('change', () => handleRfidSourceFile(fileInput.files?.[0]));
    }
    if (refPickBtn && refFile) {
        refPickBtn.addEventListener('click', () => refFile.click());
    }
    if (refFile) {
        refFile.addEventListener('change', () => handleRfidRefFile(refFile.files?.[0]));
    }
    if (refSheetSelect) {
        refSheetSelect.addEventListener('change', () => handleRfidRefSheetOrKindChange());
    }
    if (refKindSelect) {
        refKindSelect.addEventListener('change', () => handleRfidRefSheetOrKindChange());
    }
    if (refTemplateBtn) {
        refTemplateBtn.addEventListener('click', () => {
            const a = document.createElement('a');
            a.href = 'templates/RFID_운영부서코드_양식.xlsx';
            a.download = 'RFID_운영부서코드_양식.xlsx';
            a.click();
        });
    }
    if (sheetSelect) {
        sheetSelect.addEventListener('change', () => handleRfidSheetChange());
    }
    ['rfidDefaultDept', 'rfidDefaultLedger', 'rfidDefaultDomestic', 'rfidDefaultCountry', 'rfidDefaultReason']
        .forEach((id) => {
            document.getElementById(id)?.addEventListener('input', () => refreshRfidPreview());
            document.getElementById(id)?.addEventListener('change', () => refreshRfidPreview());
        });
    document.getElementById('rfidAutoCatalog')?.addEventListener('change', () => refreshRfidPreview());
    if (downloadBtn) {
        downloadBtn.addEventListener('click', () => handleRfidConvertDownload());
    }
    rebuildRfidRefs().catch(() => {});
}

if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', bindRfidFormConvertUi);
}

/**
 * 국가자산 RFID 인쇄 태그 OCR → 엑셀
 * (칩 RF 읽기가 아니라 라벨 인쇄 글자 인식)
 * 인식: Firebase Functions → Google Cloud Vision
 * 동일 양식: 관리번호 / 품명 / 규격명 / 일련·소관 / 취득단가 / 취득일자
 */

const TAG_OCR_MAX_SIDE = 1800;
const TAG_OCR_JPEG_QUALITY = 0.85;

/** @type {Array<Record<string, string>>} */
let tagOcrRows = [];
let tagOcrBusy = false;
/** @type {((data: any) => Promise<any>) | null} */
let tagOcrCallable = null;

function tagOcrToast(message, type = 'info') {
    if (typeof showToast === 'function') showToast(message, type);
}

function normalizeTagOcrText(raw) {
    return String(raw || '')
        .replace(/\u00a0/g, ' ')
        .replace(/[|｜]/g, ' ')
        .replace(/[：]/g, ':')
        .replace(/[，]/g, ',')
        .replace(/[～]/g, '~')
        .replace(/[×✕]/g, 'x')
        .replace(/[Oo](?=\d)/g, '0') // 흔한 OCR 혼동 완화 (숫자 앞 O)
        .replace(/[ \t]+/g, ' ')
        .replace(/\r/g, '')
        .trim();
}

function cleanTagFieldValue(value) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .replace(/^[:\-\s]+/, '')
        .replace(/\s+$/, '')
        .trim();
}

function extractTagField(text, labels, stopLabels) {
    const stop = (stopLabels || [])
        .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');
    const stopPart = stop ? `(?=\\n|\\s*(?:${stop})|$)` : '$';
    for (const label of labels) {
        const re = new RegExp(
            `${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[:：]?\\s*([^\\n]+?)${stopPart}`,
            'i'
        );
        const m = text.match(re);
        if (m && m[1]) return cleanTagFieldValue(m[1]);
    }
    return '';
}

function splitTagOcrBlocks(text) {
    const normalized = normalizeTagOcrText(text);
    if (!normalized) return [];

    // 여러 태그가 한 OCR 결과에 섞인 경우: 관리번호 또는 국가자산 문구로 분리
    const byAssetMark = normalized.split(/(?=이\s*물품은\s*국가자산)/);
    const candidates = [];
    byAssetMark.forEach((chunk, idx) => {
        const piece = chunk.trim();
        if (!piece) return;
        // 국가자산 구분자는 앞 블록 끝에 붙는 경우가 많아, 다음 블록과 재조합하지 않고 관리번호 기준으로 재분리
        const parts = piece.split(/(?=관리\s*번호)/i).map((p) => p.trim()).filter(Boolean);
        if (parts.length > 1) {
            parts.forEach((p) => candidates.push(p));
        } else if (idx === 0 || /관리\s*번호|품\s*명|규격/i.test(piece)) {
            candidates.push(piece);
        }
    });

    if (candidates.length) return candidates;

    const byMgmt = normalized.split(/(?=관리\s*번호)/i).map((p) => p.trim()).filter(Boolean);
    return byMgmt.length ? byMgmt : [normalized];
}

function parseOneAssetTagText(rawText, meta = {}) {
    const text = normalizeTagOcrText(rawText);

    let assetNumber = extractTagField(text, ['관리번호', '관리 번호'], ['품명', '규격명', '규격', '취득']);
    if (!assetNumber) {
        const m = text.match(/\b(KKR-[A-Z0-9\-]+)\b/i);
        if (m) assetNumber = m[1].toUpperCase();
    }

    let itemName = extractTagField(text, ['품명'], ['규격명', '규격', '취득', '관리번호']);
    let spec = extractTagField(text, ['규격명', '규격'], ['취득', '관리번호', '품명', '이 물품은']);

    // RFID 일련 + 소관 (예: 0941… / 산업통상자원부)
    let rfidSerial = '';
    let agency = '';
    const serialLine = text.match(/(\d{12,20})\s*[\/／]\s*([^\n관리품명규격취득]{2,40})/);
    if (serialLine) {
        rfidSerial = serialLine[1];
        agency = cleanTagFieldValue(serialLine[2]).replace(/\s*이\s*물품.*$/, '');
    } else {
        const onlySerial = text.match(/\b(\d{15,20})\b/);
        if (onlySerial) rfidSerial = onlySerial[1];
        const agencyHint = text.match(/(산업통상자원부|기획재정부|조달청|[가-힣]{2,12}부)/);
        if (agencyHint) agency = agencyHint[1];
    }

    let unitPrice = '';
    const priceMatch = text.match(/(?:취득\s*(?:\(납품\))?\s*)?단가\s*[:：]?\s*([0-9,]{2,})\s*원?/i);
    if (priceMatch) unitPrice = `${priceMatch[1].replace(/\s/g, '')}원`;

    let acquiredAt = '';
    const dateLabeled = text.match(/(?:취득\s*(?:\(납품\))?\s*)?일자\s*[:：]?\s*(20\d{2}\s*[-./]\s*\d{1,2}\s*[-./]\s*\d{1,2})/i);
    const dateAny = text.match(/(20\d{2}[-./]\d{1,2}[-./]\d{1,2})/);
    const dateRaw = (dateLabeled && dateLabeled[1]) || (dateAny && dateAny[1]) || '';
    if (dateRaw) {
        acquiredAt = dateRaw.replace(/\s/g, '').replace(/[./]/g, '-');
    }

    const confidence = [
        assetNumber,
        itemName,
        spec,
        rfidSerial,
        unitPrice,
        acquiredAt
    ].filter(Boolean).length;

    return {
        sourceFile: meta.sourceFile || '',
        region: meta.region || '',
        assetNumber,
        itemName,
        spec,
        rfidSerial,
        agency,
        unitPrice,
        acquiredAt,
        confidence: String(confidence),
        rawText: text.slice(0, 800)
    };
}

function parseAssetTagOcrText(rawText, meta = {}) {
    return splitTagOcrBlocks(rawText)
        .map((block) => parseOneAssetTagText(block, meta))
        .filter((row) => row.assetNumber || row.itemName || row.rfidSerial);
}

function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('이미지를 열 수 없습니다'));
        };
        img.src = url;
    });
}

/** 대비·해상도 올려 OCR 안정화 */
function preprocessTagImageToCanvas(source, options = {}) {
    const maxSide = options.maxSide || 1800;
    const sw = source.width || source.videoWidth || 0;
    const sh = source.height || source.videoHeight || 0;
    if (!sw || !sh) throw new Error('이미지 크기를 읽을 수 없습니다');

    const scale = Math.min(2.2, Math.max(1, maxSide / Math.max(sw, sh)));
    const w = Math.round(sw * scale);
    const h = Math.round(sh * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, w, h);

    const imageData = ctx.getImageData(0, 0, w, h);
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
        const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        // 약간의 대비 강조
        const v = gray < 128 ? Math.max(0, gray * 0.85) : Math.min(255, gray * 1.12);
        d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
}

function cropCanvasRegion(sourceCanvas, x0, x1) {
    const left = Math.max(0, Math.floor(x0));
    const right = Math.min(sourceCanvas.width, Math.ceil(x1));
    const width = Math.max(1, right - left);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = sourceCanvas.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(
        sourceCanvas,
        left, 0, width, sourceCanvas.height,
        0, 0, width, sourceCanvas.height
    );
    return canvas;
}

/** 가로로 긴 사진(태그 2장 나란히)이면 좌·우 분리 */
function buildTagOcrRegions(fullCanvas) {
    const ratio = fullCanvas.width / Math.max(1, fullCanvas.height);
    if (ratio < 1.15) {
        return [{ canvas: fullCanvas, region: '전체' }];
    }
    const mid = fullCanvas.width / 2;
    const overlap = Math.round(fullCanvas.width * 0.03);
    return [
        { canvas: cropCanvasRegion(fullCanvas, 0, mid + overlap), region: '좌' },
        { canvas: cropCanvasRegion(fullCanvas, mid - overlap, fullCanvas.width), region: '우' }
    ];
}

function getTagOcrCallable() {
    if (tagOcrCallable) return tagOcrCallable;
    if (typeof firebase === 'undefined' || !firebase.functions) {
        throw new Error('Firebase Functions를 사용할 수 없습니다. 페이지를 새로고침하세요.');
    }
    const user = firebase.auth?.()?.currentUser;
    if (!user) {
        throw new Error('로그인이 필요합니다. 로그인 후 다시 시도하세요.');
    }
    tagOcrCallable = firebase.functions().httpsCallable('ocrAssetTagImage');
    return tagOcrCallable;
}

function canvasToJpegBase64(canvas, quality = TAG_OCR_JPEG_QUALITY) {
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    const idx = dataUrl.indexOf('base64,');
    return idx >= 0 ? dataUrl.slice(idx + 'base64,'.length) : dataUrl;
}

/**
 * Cloud Vision OCR 호출 (Functions에 API 키 보관)
 */
async function recognizeTagCanvasCloud(canvas) {
    const imageBase64 = canvasToJpegBase64(canvas);
    const callable = getTagOcrCallable();
    try {
        const result = await callable({ imageBase64 });
        return String(result?.data?.text || '');
    } catch (error) {
        const code = error?.code || error?.details || '';
        const msg = String(error?.message || error || '');
        if (/unauthenticated|로그인/i.test(msg + code)) {
            throw new Error('로그인이 필요합니다. 로그인 후 다시 시도하세요.');
        }
        if (/not-found|NOT_FOUND|does not exist/i.test(msg + code)) {
            throw new Error('OCR 함수가 배포되지 않았습니다. firebase deploy --only functions 후 다시 시도하세요.');
        }
        if (/failed-precondition|Vision API/i.test(msg + code)) {
            throw new Error(msg || 'Cloud Vision API를 GCP 콘솔에서 사용 설정해 주세요.');
        }
        if (/resource-exhausted|deadline|timeout/i.test(msg + code)) {
            throw new Error('OCR 서버 응답이 지연되었습니다. 잠시 후 다시 시도하세요.');
        }
        throw new Error(msg.slice(0, 200) || '클라우드 OCR 호출에 실패했습니다');
    }
}

function setTagOcrStatus(message) {
    const el = document.getElementById('tagOcrStatus');
    if (el) el.textContent = message || '';
}

function setTagOcrBusy(busy) {
    tagOcrBusy = !!busy;
    const pick = document.getElementById('tagOcrPickBtn');
    const run = document.getElementById('tagOcrRunBtn');
    const exp = document.getElementById('tagOcrExportBtn');
    const clear = document.getElementById('tagOcrClearBtn');
    if (pick) pick.disabled = busy;
    if (run) run.disabled = busy || !(document.getElementById('tagOcrFile')?.files?.length);
    if (exp) exp.disabled = busy || !tagOcrRows.length;
    if (clear) clear.disabled = busy;
}

function updateTagOcrExportEnabled() {
    const exp = document.getElementById('tagOcrExportBtn');
    if (exp) exp.disabled = tagOcrBusy || !tagOcrRows.length;
}

function renderTagOcrTable() {
    const panel = document.getElementById('tagOcrPanel');
    const wrap = document.getElementById('tagOcrTableWrap');
    if (!panel || !wrap) return;

    if (!tagOcrRows.length) {
        panel.hidden = true;
        wrap.innerHTML = '';
        updateTagOcrExportEnabled();
        return;
    }

    panel.hidden = false;
    const head = [
        ['assetNumber', '관리번호'],
        ['itemName', '품명'],
        ['spec', '규격명'],
        ['rfidSerial', 'RFID일련'],
        ['agency', '소관'],
        ['unitPrice', '취득단가'],
        ['acquiredAt', '취득일자'],
        ['sourceFile', '파일'],
        ['region', '영역']
    ];

    const rowsHtml = tagOcrRows.map((row, idx) => {
        const cells = head.map(([key]) => {
            const val = row[key] || '';
            const safe = String(val)
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;')
                .replace(/</g, '&lt;');
            return `<td><input type="text" data-row="${idx}" data-key="${key}" value="${safe}"></td>`;
        }).join('');
        return `<tr>${cells}<td><button type="button" class="btn btn-secondary btn-small tag-ocr-del" data-row="${idx}">삭제</button></td></tr>`;
    }).join('');

    wrap.innerHTML = `
        <div class="tag-ocr-scroll">
            <table class="tag-ocr-table">
                <thead>
                    <tr>
                        ${head.map(([, label]) => `<th>${label}</th>`).join('')}
                        <th></th>
                    </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
            </table>
        </div>
        <p class="tag-ocr-hint">${tagOcrRows.length}건 — 인식이 틀리면 표에서 고친 뒤 엑셀로 받으세요.</p>
    `;

    wrap.querySelectorAll('input[data-row]').forEach((input) => {
        input.addEventListener('change', () => {
            const r = Number(input.dataset.row);
            const key = input.dataset.key;
            if (!tagOcrRows[r] || !key) return;
            tagOcrRows[r][key] = input.value.trim();
        });
    });
    wrap.querySelectorAll('.tag-ocr-del').forEach((btn) => {
        btn.addEventListener('click', () => {
            const r = Number(btn.dataset.row);
            tagOcrRows.splice(r, 1);
            renderTagOcrTable();
            setTagOcrStatus(`남은 ${tagOcrRows.length}건`);
        });
    });

    updateTagOcrExportEnabled();
}

function dedupeTagOcrRows(rows) {
    const seen = new Set();
    const out = [];
    rows.forEach((row) => {
        const key = [
            row.assetNumber,
            row.itemName,
            row.rfidSerial,
            row.acquiredAt
        ].join('|').toLowerCase();
        if (!row.assetNumber && !row.rfidSerial && !row.itemName) return;
        if (seen.has(key)) return;
        seen.add(key);
        out.push(row);
    });
    return out;
}

function pushParsedOrRaw(collected, text, meta) {
    const parsed = parseAssetTagOcrText(text, meta);
    if (parsed.length) {
        collected.push(...parsed);
        return parsed.length;
    }
    if (String(text || '').trim()) {
        collected.push({
            sourceFile: meta.sourceFile || '',
            region: meta.region || '',
            assetNumber: '',
            itemName: '',
            spec: '',
            rfidSerial: '',
            agency: '',
            unitPrice: '',
            acquiredAt: '',
            confidence: '0',
            rawText: normalizeTagOcrText(text).slice(0, 800)
        });
        return 0;
    }
    return 0;
}

async function runTagOcrOnFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name));
    if (!files.length) {
        tagOcrToast('이미지 파일을 선택하세요', 'error');
        return;
    }

    setTagOcrBusy(true);
    setTagOcrStatus('클라우드 OCR 준비 중…');
    const collected = [];

    try {
        // 로그인·Functions 핸들 선행 확인
        getTagOcrCallable();

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            setTagOcrStatus(`이미지 ${i + 1}/${files.length}: ${file.name} 업로드·인식 중…`);
            const img = await loadImageFromFile(file);
            const full = preprocessTagImageToCanvas(img, { maxSide: TAG_OCR_MAX_SIDE });

            // 1) 전체 이미지 1회 (Vision이 다중 태그에 강함)
            let text = await recognizeTagCanvasCloud(full);
            let found = pushParsedOrRaw(collected, text, {
                sourceFile: file.name,
                region: '전체'
            });

            // 2) 전체에서 필드가 약하면 좌·우 분할 재시도 (태그 2장 나란히)
            const regions = buildTagOcrRegions(full);
            if (found < 1 && regions.length > 1) {
                for (const region of regions) {
                    setTagOcrStatus(`이미지 ${i + 1}/${files.length} · ${region.region} 영역 재인식…`);
                    text = await recognizeTagCanvasCloud(region.canvas);
                    pushParsedOrRaw(collected, text, {
                        sourceFile: file.name,
                        region: region.region
                    });
                }
            } else if (found === 1 && regions.length > 1) {
                // 한 장만 잡힌 경우 반대쪽도 한 번 더
                for (const region of regions) {
                    setTagOcrStatus(`이미지 ${i + 1}/${files.length} · ${region.region} 영역 보완 인식…`);
                    text = await recognizeTagCanvasCloud(region.canvas);
                    pushParsedOrRaw(collected, text, {
                        sourceFile: file.name,
                        region: region.region
                    });
                }
            }
        }

        tagOcrRows = dedupeTagOcrRows(collected);
        renderTagOcrTable();
        if (!tagOcrRows.length) {
            setTagOcrStatus('인식된 태그가 없습니다. 태그가 크게·밝게 나오게 다시 찍어 보세요.');
            tagOcrToast('태그를 찾지 못했습니다', 'error');
        } else {
            setTagOcrStatus(`${tagOcrRows.length}건 클라우드 인식 완료 — 표를 확인한 뒤 엑셀로 받으세요.`);
            tagOcrToast(`${tagOcrRows.length}건 인식 완료`, 'success');
        }
    } catch (error) {
        console.warn('태그 OCR 실패:', error);
        setTagOcrStatus(error?.message || 'OCR 실패');
        tagOcrToast(error?.message || 'OCR에 실패했습니다', 'error');
    } finally {
        setTagOcrBusy(false);
    }
}

function exportTagOcrExcel() {
    if (!tagOcrRows.length) {
        tagOcrToast('내보낼 데이터가 없습니다', 'info');
        return;
    }
    if (typeof XLSX === 'undefined') {
        tagOcrToast('엑셀 라이브러리를 불러오지 못했습니다', 'error');
        return;
    }

    // 입력값 동기화
    document.querySelectorAll('#tagOcrTableWrap input[data-row]').forEach((input) => {
        const r = Number(input.dataset.row);
        const key = input.dataset.key;
        if (tagOcrRows[r] && key) tagOcrRows[r][key] = input.value.trim();
    });

    const sheetRows = tagOcrRows.map((row, i) => ({
        순번: i + 1,
        관리번호: row.assetNumber || '',
        품명: row.itemName || '',
        규격명: row.spec || '',
        RFID일련번호: row.rfidSerial || '',
        소관: row.agency || '',
        취득단가: row.unitPrice || '',
        취득일자: row.acquiredAt || '',
        원본파일: row.sourceFile || '',
        인식영역: row.region || ''
    }));

    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(sheetRows);
    XLSX.utils.book_append_sheet(workbook, sheet, '태그OCR');
    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `RFID태그_OCR_${sheetRows.length}건_${today}.xlsx`);
    tagOcrToast(`${sheetRows.length}건 엑셀 저장`, 'success');
}

function clearTagOcrResults() {
    tagOcrRows = [];
    renderTagOcrTable();
    setTagOcrStatus('결과를 지웠습니다.');
    const input = document.getElementById('tagOcrFile');
    if (input) input.value = '';
    const run = document.getElementById('tagOcrRunBtn');
    if (run) run.disabled = true;
}

function bindTagOcrUi() {
    const fileInput = document.getElementById('tagOcrFile');
    const pickBtn = document.getElementById('tagOcrPickBtn');
    const runBtn = document.getElementById('tagOcrRunBtn');
    const exportBtn = document.getElementById('tagOcrExportBtn');
    const clearBtn = document.getElementById('tagOcrClearBtn');
    if (!fileInput || !pickBtn || fileInput.dataset.bound === 'true') return;
    fileInput.dataset.bound = 'true';

    pickBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
        const n = fileInput.files?.length || 0;
        if (runBtn) runBtn.disabled = tagOcrBusy || n === 0;
        setTagOcrStatus(n ? `${n}개 이미지 선택됨 — 「글자 인식」을 누르세요.` : '');
    });
    runBtn?.addEventListener('click', () => {
        if (tagOcrBusy) return;
        runTagOcrOnFiles(fileInput.files);
    });
    exportBtn?.addEventListener('click', () => exportTagOcrExcel());
    clearBtn?.addEventListener('click', () => clearTagOcrResults());
}

// 단위 테스트용 (콘솔)
window.parseAssetTagOcrText = parseAssetTagOcrText;
window.__tagOcr = {
    parse: parseAssetTagOcrText,
    run: runTagOcrOnFiles,
    export: exportTagOcrExcel
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindTagOcrUi);
} else {
    bindTagOcrUi();
}

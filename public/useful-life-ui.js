// 내용연수 후보를 카드로 고르고, 같은 이름은 다음에 자동 확정되게 학습한다

const USEFUL_LIFE_UI_DEBOUNCE_MS = 280;
const USEFUL_LIFE_UI_INLINE_LIMIT = 4;

let usefulLifeUiTimer = null;
let usefulLifeUiSearchTimer = null;
let usefulLifeUiLast = null;
let usefulLifeUiBound = false;
let usefulLifeUiManual = false;

function usefulLifeYearsLabel(entry) {
    if (!entry) return '';
    if (entry.notified && entry.usefulLife > 0) return `${entry.usefulLife}년`;
    return '미고시';
}

function usefulLifeMatchLabel(match) {
    const map = {
        code: '분류번호',
        alias: '학습됨',
        exact: '정확일치',
        synonym: '약칭',
        locale: '영한변환',
        family: '제품군',
        contains: '포함',
        partial: '유사',
        similar: '유사',
        search: '검색',
        pick: '선택'
    };
    return map[match] || match || '';
}

function usefulLifeEscape(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function getUsefulLifeFormSource(prefix) {
    const nameId = prefix ? `${prefix}ItemName` : 'itemName';
    const acquiredId = prefix ? `${prefix}AcquiredAt` : 'acquiredAt';
    const codeId = prefix ? `${prefix}GoodsClNo` : 'goodsClNo';
    return {
        prefix: prefix || '',
        itemName: document.getElementById(nameId)?.value || '',
        acquiredAt: document.getElementById(acquiredId)?.value || '',
        goodsClNo: document.getElementById(codeId)?.value || ''
    };
}

function setUsefulLifeHiddenFields(prefix, entry) {
    const p = prefix || '';
    const set = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.value = value == null ? '' : String(value);
    };
    set(p ? `${p}GoodsClNo` : 'goodsClNo', entry?.goodsClNo || '');
    set(p ? `${p}GoodsClNm` : 'goodsClNm', entry?.goodsClNm || '');
    set(p ? `${p}UsefulLife` : 'usefulLife', entry?.usefulLife > 0 ? entry.usefulLife : '');
}

function usefulLifeCandidateButton(candidate, index) {
    const years = usefulLifeYearsLabel(candidate);
    const badge = candidate.notified ? '고시' : '미고시';
    return `
        <button type="button" class="ul-candidate" data-ul-pick="${index}">
            <span class="ul-candidate-name">${usefulLifeEscape(candidate.goodsClNm)}</span>
            <span class="ul-candidate-meta">
                <strong>${usefulLifeEscape(years)}</strong>
                <em>${badge}</em>
                <small>${usefulLifeEscape(candidate.goodsClNo)}</small>
            </span>
        </button>
    `;
}

function renderUsefulLifePanel(result, source) {
    const panel = document.getElementById('usefulLifePanel');
    if (!panel) return;
    usefulLifeUiLast = { result, source };

    const name = String(source.itemName || '').trim();
    if (!name) {
        panel.hidden = true;
        panel.innerHTML = '';
        if (!usefulLifeUiManual) setUsefulLifeHiddenFields(source.prefix, null);
        return;
    }

    panel.hidden = false;
    const entry = result?.entry || null;
    const candidates = result?.candidates || [];
    const verdict = result?.verdict || 'missing';

    if (!usefulLifeUiManual && entry) setUsefulLifeHiddenFields(source.prefix, entry);
    if (!usefulLifeUiManual && !entry && verdict !== 'resolved') {
        // 자동 확정이 아니면 숨은 분류는 비워 두고, 사람이 고를 때까지 대기
        if (!document.getElementById(source.prefix ? `${source.prefix}GoodsClNo` : 'goodsClNo')?.value) {
            setUsefulLifeHiddenFields(source.prefix, null);
        }
    }

    let statusHtml = '';
    if (verdict === 'resolved' || verdict === 'unnotified') {
        const life = typeof describeUsefulLife === 'function'
            ? describeUsefulLife(source)
            : null;
        statusHtml = `
            <div class="ul-status is-${verdict}">
                <div class="ul-status-main">
                    <strong>${usefulLifeEscape(entry.goodsClNm)}</strong>
                    <span>${usefulLifeEscape(usefulLifeYearsLabel(entry))}</span>
                    <em>${usefulLifeEscape(usefulLifeMatchLabel(entry.match))}</em>
                </div>
                <div class="ul-status-sub">
                    ${life && life.label ? usefulLifeEscape(life.label) : usefulLifeEscape(entry.goodsClNo)}
                    ${life && life.note ? ` · ${usefulLifeEscape(life.note)}` : ''}
                </div>
            </div>
        `;
    } else if (verdict === 'ambiguous') {
        statusHtml = `
            <div class="ul-status is-ambiguous">
                <div class="ul-status-main"><strong>분류 확인이 필요합니다</strong></div>
                <div class="ul-status-sub">아래 후보를 탭하거나 검색하세요</div>
            </div>
        `;
    } else {
        statusHtml = `
            <div class="ul-status is-missing">
                <div class="ul-status-main"><strong>내용연수 표에서 찾지 못했습니다</strong></div>
                <div class="ul-status-sub">검색으로 직접 고를 수 있습니다</div>
            </div>
        `;
    }

    const inline = candidates.slice(0, USEFUL_LIFE_UI_INLINE_LIMIT)
        .map((candidate, index) => usefulLifeCandidateButton(candidate, index))
        .join('');

    panel.innerHTML = `
        ${statusHtml}
        ${inline ? `<div class="ul-candidate-list" data-ul-inline="1">${inline}</div>` : ''}
        <div class="ul-actions">
            <button type="button" class="btn btn-secondary btn-small" data-ul-action="open">🔎 분류 고르기</button>
            ${entry ? '<button type="button" class="btn btn-secondary btn-small" data-ul-action="clear">선택 지우기</button>' : ''}
        </div>
    `;
}

async function refreshUsefulLifeUi(options = {}) {
    const prefix = options.prefix || '';
    const source = getUsefulLifeFormSource(prefix);
    if (options.force) usefulLifeUiManual = false;
    if (typeof ensureUsefulLifeTable === 'function') {
        await ensureUsefulLifeTable();
    }
    if (typeof describeUsefulLife !== 'function') return;

    // 수동으로 고른 뒤에는 물품명만 바뀌기 전까지 덮어쓰지 않는다
    if (usefulLifeUiManual && !options.force) {
        const code = source.goodsClNo;
        if (code && typeof lookupUsefulLifeByCode === 'function') {
            const entry = lookupUsefulLifeByCode(code);
            if (entry) {
                renderUsefulLifePanel({
                    verdict: entry.notified ? 'resolved' : 'unnotified',
                    entry: { ...entry, match: 'pick' },
                    candidates: [],
                    auto: false
                }, source);
                return;
            }
        }
    }

    const result = describeUsefulLife(source);
    renderUsefulLifePanel(result, source);
}

function scheduleUsefulLifeUiRefresh(prefix) {
    clearTimeout(usefulLifeUiTimer);
    usefulLifeUiTimer = setTimeout(() => {
        usefulLifeUiManual = false;
        refreshUsefulLifeUi({ prefix: prefix || '', force: true });
    }, USEFUL_LIFE_UI_DEBOUNCE_MS);
}

async function applyUsefulLifePick(candidate, options = {}) {
    if (!candidate) return;
    const source = options.source || getUsefulLifeFormSource(options.prefix || '');
    const learn = options.learn !== false;
    const entry = {
        goodsClNo: candidate.goodsClNo,
        goodsClNm: candidate.goodsClNm,
        usefulLife: Number(candidate.usefulLife) || 0,
        notified: !!candidate.notified,
        match: 'pick'
    };

    usefulLifeUiManual = true;
    setUsefulLifeHiddenFields(source.prefix, entry);
    renderUsefulLifePanel({
        verdict: entry.notified ? 'resolved' : 'unnotified',
        entry,
        candidates: [],
        auto: false
    }, source);

    if (learn && source.itemName && typeof saveUsefulLifeAlias === 'function') {
        try {
            await saveUsefulLifeAlias({
                nameKey: source.itemName,
                goodsClNo: entry.goodsClNo,
                goodsClNm: entry.goodsClNm,
                usefulLife: entry.usefulLife
            });
            if (typeof showToast === 'function') {
                showToast(`"${entry.goodsClNm}"으로 저장 · 같은 이름은 다음부터 자동`, 'success');
            }
        } catch (error) {
            console.warn('내용연수 사전 저장 실패:', error);
            if (typeof showToast === 'function') {
                showToast('분류는 적용됐지만 학습 저장에 실패했습니다', 'info');
            }
        }
    } else if (typeof showToast === 'function') {
        showToast(`"${entry.goodsClNm}" 적용`, 'success');
    }
}

function clearUsefulLifePick(prefix) {
    usefulLifeUiManual = false;
    setUsefulLifeHiddenFields(prefix || '', null);
    if (typeof removeUsefulLifeAlias === 'function') {
        const name = getUsefulLifeFormSource(prefix).itemName;
        if (name) removeUsefulLifeAlias(name).catch(() => {});
    }
    refreshUsefulLifeUi({ prefix: prefix || '', force: true });
}

function clearUsefulLifeDirectFields() {
    const name = document.getElementById('usefulLifeDirectName');
    const code = document.getElementById('usefulLifeDirectCode');
    if (name) name.value = '';
    if (code) code.value = '';
}

function resolveUsefulLifeDirectCandidate() {
    const name = String(document.getElementById('usefulLifeDirectName')?.value || '').trim();
    const code = String(document.getElementById('usefulLifeDirectCode')?.value || '').trim();
    const text = code && !name.includes('[') ? `${name} [${code}]`.trim() : (name || code);
    if (!text || typeof parseUsefulLifeSelectOption !== 'function' || typeof resolveUsefulLifeSelection !== 'function') {
        return null;
    }
    const parsed = parseUsefulLifeSelectOption(text);
    const entry = resolveUsefulLifeSelection(parsed);
    if (!entry?.goodsClNo) return null;
    return {
        goodsClNo: entry.goodsClNo,
        goodsClNm: entry.goodsClNm || parsed?.goodsClNm || '',
        usefulLife: Number(entry.usefulLife) || 0,
        notified: entry.notified !== false && Number(entry.usefulLife) > 0
    };
}

async function applyUsefulLifeDirectInput() {
    const candidate = resolveUsefulLifeDirectCandidate();
    if (!candidate) {
        if (typeof showToast === 'function') {
            showToast('표에 있는 품명 또는 분류번호를 입력하세요. 예: 디지털카메라 [45121504]', 'error');
        }
        return;
    }
    const learn = document.getElementById('usefulLifeLearnSame')?.checked !== false;
    const list = document.getElementById('usefulLifePickerList');
    const registerId = list?.dataset.ulRegisterId || '';
    if (list) list.dataset.ulRegisterId = '';
    closeUsefulLifePicker();
    if (registerId && typeof applyUsefulLifeRegisterPick === 'function') {
        await applyUsefulLifeRegisterPick(registerId, candidate, learn);
        return;
    }
    await applyUsefulLifePick(candidate, { learn });
}

function openUsefulLifePicker() {
    const modal = document.getElementById('usefulLifePickerModal');
    if (!modal) return;
    const list = document.getElementById('usefulLifePickerList');
    if (list) list.dataset.ulRegisterId = '';
    const source = getUsefulLifeFormSource('');
    const result = usefulLifeUiLast?.result || (typeof describeUsefulLife === 'function'
        ? describeUsefulLife(source)
        : { candidates: [] });

    const title = document.getElementById('usefulLifePickerTitle');
    if (title) title.textContent = source.itemName ? `"${source.itemName}" 분류 고르기` : '분류 고르기';

    const learn = document.getElementById('usefulLifeLearnSame');
    if (learn) learn.checked = true;

    const search = document.getElementById('usefulLifeSearch');
    if (search) search.value = '';
    clearUsefulLifeDirectFields();

    renderUsefulLifePickerList(result.candidates || [], source.itemName);
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
    setTimeout(() => search?.focus(), 50);
}

function closeUsefulLifePicker() {
    const modal = document.getElementById('usefulLifePickerModal');
    if (!modal) return;
    const list = document.getElementById('usefulLifePickerList');
    if (list) list.dataset.ulRegisterId = '';
    modal.classList.remove('show');
    document.body.style.overflow = 'auto';
}

function renderUsefulLifePickerList(candidates, queryHint, options = {}) {
    const list = document.getElementById('usefulLifePickerList');
    const empty = document.getElementById('usefulLifePickerEmpty');
    if (!list) return;

    const rows = candidates || [];
    list.dataset.ulCandidates = JSON.stringify(rows);
    list.innerHTML = rows.map((candidate, index) => usefulLifeCandidateButton(candidate, index)).join('');

    if (!empty) return;
    if (!rows.length) {
        empty.hidden = false;
        empty.textContent = queryHint
            ? `"${queryHint}"에 맞는 분류가 없습니다. 다른 검색어를 입력하세요.`
            : '검색어를 입력하세요.';
        return;
    }
    empty.hidden = false;
    empty.textContent = options.truncated
        ? `짧은 검색어는 ${rows.length}개만 표시합니다. 글자를 더 입력하면 맞는 분류를 모두 볼 수 있습니다.`
        : `${rows.length}건`;
}

function usefulLifePickerSearchLimit(query) {
    const raw = String(query || '').trim();
    const key = typeof normalizeGoodsName === 'function' ? normalizeGoodsName(raw) : raw.toLowerCase();
    const digits = raw.replace(/\D/g, '');
    const digitsOnly = digits.length > 0 && digits.length === raw.replace(/\s/g, '').length;
    if ((key && key.length <= 1) || (digitsOnly && digits.length <= 2)) return 20;
    return 20000;
}

function scheduleUsefulLifeSearch() {
    clearTimeout(usefulLifeUiSearchTimer);
    usefulLifeUiSearchTimer = setTimeout(() => {
        const query = document.getElementById('usefulLifeSearch')?.value || '';
        if (!query.trim()) {
            const fallback = usefulLifeUiLast?.result?.candidates || [];
            renderUsefulLifePickerList(fallback, getUsefulLifeFormSource('').itemName);
            return;
        }
        if (typeof searchUsefulLifeClasses !== 'function') return;
        const limit = usefulLifePickerSearchLimit(query);
        const hits = searchUsefulLifeClasses(query, limit);
        renderUsefulLifePickerList(hits, query.trim(), { truncated: hits.length >= limit });
    }, 200);
}

function bindUsefulLifeUi() {
    if (usefulLifeUiBound) return;
    usefulLifeUiBound = true;

    const itemName = document.getElementById('itemName');
    const acquiredAt = document.getElementById('acquiredAt');
    if (itemName) {
        itemName.addEventListener('input', () => scheduleUsefulLifeUiRefresh(''));
        itemName.addEventListener('change', () => scheduleUsefulLifeUiRefresh(''));
    }
    if (acquiredAt) {
        acquiredAt.addEventListener('change', () => refreshUsefulLifeUi({ force: true }));
    }

    const panel = document.getElementById('usefulLifePanel');
    if (panel) {
        panel.addEventListener('click', async (event) => {
            const action = event.target.closest('[data-ul-action]')?.dataset.ulAction;
            if (action === 'open') {
                openUsefulLifePicker();
                return;
            }
            if (action === 'clear') {
                clearUsefulLifePick('');
                return;
            }
            const pick = event.target.closest('[data-ul-pick]');
            if (!pick) return;
            const index = Number(pick.dataset.ulPick);
            const candidate = usefulLifeUiLast?.result?.candidates?.[index];
            if (candidate) await applyUsefulLifePick(candidate, { learn: true });
        });
    }

    document.getElementById('closeUsefulLifePicker')?.addEventListener('click', closeUsefulLifePicker);
    document.getElementById('usefulLifePickerModal')?.addEventListener('click', (event) => {
        if (event.target.id === 'usefulLifePickerModal') closeUsefulLifePicker();
    });
    document.getElementById('usefulLifeSearch')?.addEventListener('input', scheduleUsefulLifeSearch);
    document.getElementById('usefulLifeDirectApply')?.addEventListener('click', () => {
        applyUsefulLifeDirectInput().catch((error) => {
            console.warn('내용연수 직접 입력 실패:', error);
            if (typeof showToast === 'function') showToast('직접 입력 반영에 실패했습니다', 'error');
        });
    });
    document.getElementById('usefulLifeDirectCode')?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') document.getElementById('usefulLifeDirectApply')?.click();
    });

    document.getElementById('usefulLifePickerList')?.addEventListener('click', async (event) => {
        const pick = event.target.closest('[data-ul-pick]');
        if (!pick) return;
        const list = document.getElementById('usefulLifePickerList');
        let candidates = [];
        try {
            candidates = JSON.parse(list?.dataset.ulCandidates || '[]');
        } catch (error) {
            candidates = [];
        }
        const candidate = candidates[Number(pick.dataset.ulPick)];
        if (!candidate) return;
        const learn = document.getElementById('usefulLifeLearnSame')?.checked !== false;
        await applyUsefulLifePick(candidate, { learn });
        closeUsefulLifePicker();
    });

    if (typeof ensureUsefulLifeTable === 'function') {
        ensureUsefulLifeTable().then(() => refreshUsefulLifeUi({ force: true }));
    }
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindUsefulLifeUi);
    } else {
        bindUsefulLifeUi();
    }
}

window.refreshUsefulLifeUi = refreshUsefulLifeUi;
window.openUsefulLifePicker = openUsefulLifePicker;
window.applyUsefulLifePick = applyUsefulLifePick;

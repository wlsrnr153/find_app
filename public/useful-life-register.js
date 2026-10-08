// 대장 내용연수 탭 — 업로드된 자산 대장을 매칭·필터·엑셀 분석한다

const UL_REGISTER_PAGE_SIZE = 80;

let ulRegisterFilter = 'all';
let ulRegisterSearch = '';
let ulRegisterSearchTimer = null;
let ulRegisterVisible = UL_REGISTER_PAGE_SIZE;
let ulRegisterCache = [];
let ulRegisterBound = false;

function escapeUlRegisterHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function usefulLifeRegisterAliasFor(record) {
    if (typeof getUsefulLifeAliases !== 'function' || typeof normalizeGoodsName !== 'function') {
        return null;
    }
    const keys = [
        record?.itemName,
        record?.goodsClNm,
        usefulLifeRegisterSpecHead(record)
    ].map((value) => normalizeGoodsName(value)).filter(Boolean);
    if (!keys.length) return null;
    const aliases = getUsefulLifeAliases() || [];
    let best = null;
    aliases.forEach((alias) => {
        const key = normalizeGoodsName(alias?.nameKey);
        if (!key || !keys.includes(key)) return;
        if (!best || String(alias.decidedAt || '') > String(best.decidedAt || '')) best = alias;
    });
    return best;
}

/**
 * 대장 탭 판정 우선순위
 * 1) 대장에 저장된 내용연수(엑셀 반영·고르기)
 * 2) 학습사전
 * 3) 실시간 고시표 매칭
 */
function describeRegisterUsefulLife(record) {
    if (typeof describeUsefulLife !== 'function') {
        return { verdict: 'missing', note: '내용연수 엔진 없음', candidates: [] };
    }
    // 대장 품명 → 규격 앞부분 → 자산명 순으로 매칭. 자산명만으로는 판단이 어려운 경우가 많다.
    const className = String(record.goodsClNm || '').trim();
    const specHead = usefulLifeRegisterSpecHead(record);
    const itemName = String(record.itemName || '').trim();
    const live = describeUsefulLife({
        itemName: className || specHead || itemName,
        goodsClNo: record.goodsClNo,
        acquiredAt: record.acquiredAt
    });

    const storedRaw = record?.usefulLife;
    const storedMatch = String(record?.usefulLifeMatch || '');
    const storedIsUnnotified = storedMatch === 'import-unnotified'
        || (storedMatch === 'pick' && !(Number(storedRaw) > 0) && !!(record?.goodsClNo || record?.goodsClNm))
        || String(storedRaw).trim() === '미고시';
    const storedYears = Number(storedRaw);

    if (storedIsUnnotified || (storedRaw === 0 && (record?.goodsClNo || record?.goodsClNm || storedMatch))) {
        return {
            ...live,
            verdict: 'unnotified',
            usefulLife: 0,
            notified: false,
            goodsClNo: record.goodsClNo || live.goodsClNo || '',
            goodsClNm: record.goodsClNm || live.goodsClNm || '',
            entry: {
                ...(live.entry || {}),
                goodsClNo: record.goodsClNo || live.goodsClNo || '',
                goodsClNm: record.goodsClNm || live.goodsClNm || '',
                usefulLife: 0,
                notified: false,
                match: storedMatch || live.entry?.match || 'stored'
            },
            note: '대장 저장값(미고시)'
        };
    }

    if (storedYears > 0) {
        return {
            ...live,
            verdict: 'resolved',
            usefulLife: storedYears,
            notified: true,
            goodsClNo: record.goodsClNo || live.goodsClNo || '',
            goodsClNm: record.goodsClNm || live.goodsClNm || '',
            entry: {
                ...(live.entry || {}),
                goodsClNo: record.goodsClNo || live.goodsClNo || '',
                goodsClNm: record.goodsClNm || live.goodsClNm || '',
                usefulLife: storedYears,
                notified: true,
                match: storedMatch || live.entry?.match || 'stored'
            },
            note: live.note || ''
        };
    }

    // 저장값이 없으면 학습사전을 대장 표시에 반영
    const alias = usefulLifeRegisterAliasFor(record);
    if (alias?.goodsClNo || alias?.goodsClNm) {
        let years = Number(alias.usefulLife) || 0;
        let goodsClNm = alias.goodsClNm || '';
        let goodsClNo = String(alias.goodsClNo || '');
        if (!(years > 0) && goodsClNo && typeof lookupUsefulLifeByCode === 'function') {
            const byCode = lookupUsefulLifeByCode(goodsClNo);
            if (byCode) {
                years = Number(byCode.usefulLife) || 0;
                goodsClNm = byCode.goodsClNm || goodsClNm;
            }
        }
        if (years > 0) {
            return {
                ...live,
                verdict: 'resolved',
                usefulLife: years,
                notified: true,
                goodsClNo: goodsClNo || live.goodsClNo,
                goodsClNm: goodsClNm || live.goodsClNm,
                entry: {
                    goodsClNo,
                    goodsClNm,
                    usefulLife: years,
                    notified: true,
                    match: 'alias'
                },
                note: '학습사전'
            };
        }
        return {
            ...live,
            verdict: 'unnotified',
            usefulLife: 0,
            notified: false,
            goodsClNo: goodsClNo || live.goodsClNo,
            goodsClNm: goodsClNm || live.goodsClNm,
            entry: {
                goodsClNo,
                goodsClNm,
                usefulLife: 0,
                notified: false,
                match: 'alias'
            },
            note: '학습사전(미고시)'
        };
    }

    return live;
}

function buildUsefulLifeRegisterCache() {
    const register = typeof getRegisterForSurvey === 'function' ? getRegisterForSurvey() : [];
    return register.map((record) => {
        const life = describeRegisterUsefulLife(record);
        const haystack = [
            record.assetNumber, record.itemName, record.goodsClNm, record.goodsClNo,
            life.goodsClNm, record.location, record.category, record.model,
            usefulLifeVerdictLabelKo?.(life.verdict)
        ].filter(Boolean).join(' ').toLowerCase();
        return { record, life, haystack };
    });
}

function filterUsefulLifeRegisterRows(rows) {
    let filtered = rows;
    if (ulRegisterFilter !== 'all') {
        filtered = filtered.filter((row) => row.life.verdict === ulRegisterFilter);
    }
    const term = ulRegisterSearch.trim().toLowerCase();
    if (term) {
        const parts = term.split(/\s+/);
        filtered = filtered.filter((row) => parts.every((part) => row.haystack.includes(part)));
    }
    // 미고시·확인필요 등에서도 같은 분류명이 옆에 모이도록 정렬
    return filtered.slice().sort((a, b) => {
        const ca = usefulLifeRegisterEffectiveClass(a.record, a.life);
        const cb = usefulLifeRegisterEffectiveClass(b.record, b.life);
        const byClass = String(ca.key || ca.code).localeCompare(String(cb.key || cb.code), 'ko');
        if (byClass) return byClass;
        return String(a.record.itemName || '').localeCompare(String(b.record.itemName || ''), 'ko');
    });
}

function updateUsefulLifeRegisterStats(rows) {
    const stats = { total: rows.length, resolved: 0, ambiguous: 0, missing: 0, unnotified: 0 };
    rows.forEach((row) => {
        if (stats[row.life.verdict] != null) stats[row.life.verdict] += 1;
    });
    const set = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = String(value);
    };
    set('ulStatTotal', stats.total);
    set('ulStatResolved', stats.resolved);
    set('ulStatAmbiguous', stats.ambiguous);
    set('ulStatMissing', stats.missing);
    set('ulStatUnnotified', stats.unnotified);
}

function usefulLifeRegisterStatusClass(verdict) {
    return ({
        resolved: 'is-found',
        unnotified: 'is-changed',
        ambiguous: 'is-pending',
        missing: 'is-missing'
    })[verdict] || 'is-pending';
}

function usefulLifeRegisterPickerTitle(record) {
    const itemName = String(record?.itemName || '').trim() || '대장 항목';
    const className = String(record?.goodsClNm || '').trim();
    if (className && className !== itemName) {
        return `"${itemName}" / ${className} 분류 고르기`;
    }
    return `"${itemName}" 분류 고르기`;
}

function usefulLifeRegisterSpecHead(record) {
    const spec = String(record?.model || '').trim();
    if (!spec) return '';
    return spec.split(',')[0].trim();
}

function usefulLifeRegisterSearchQuery(record) {
    return [
        record?.goodsClNm,
        usefulLifeRegisterSpecHead(record),
        record?.itemName,
        record?.goodsClNo
    ].filter(Boolean).join(' ');
}

function usefulLifeRegisterClassKey(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    return typeof normalizeGoodsName === 'function' ? normalizeGoodsName(text) : text.toLowerCase();
}

function usefulLifeRegisterPool(record) {
    const register = typeof getRegisterForSurvey === 'function'
        ? getRegisterForSurvey()
        : [];
    if (register.length) return register;

    // 회차 필터가 비어 있으면 메모리 전체에서 같은 surveyId만 본다
    const surveyId = record?.surveyId || '';
    return (typeof registerItems !== 'undefined' ? registerItems : []).filter((entry) =>
        !surveyId || entry?.surveyId === surveyId
    );
}

/**
 * 화면에 보이는 분류명 기준.
 * 대장 goodsClNm이 비어 있어도 매칭된 미고시 분류명(life.goodsClNm)을 쓴다.
 */
function usefulLifeRegisterEffectiveClass(record, life) {
    const fromRecord = String(record?.goodsClNm || '').trim();
    const fromLife = String(life?.goodsClNm || '').trim();
    const label = fromRecord || fromLife;
    const code = String(record?.goodsClNo || life?.goodsClNo || '').replace(/\D/g, '');
    return {
        label,
        key: usefulLifeRegisterClassKey(label),
        code,
        fromRecord: !!fromRecord,
        fromMatch: !fromRecord && !!fromLife
    };
}

function usefulLifeRegisterCacheLife(record) {
    return ulRegisterCache.find((entry) => entry.record.id === record?.id)?.life || null;
}

/** 같은 물품명 형제 */
function findSameItemRegisterIds(record, key) {
    const matchKey = key || usefulLifeRegisterClassKey(record?.itemName);
    if (!matchKey) return [];

    return usefulLifeRegisterPool(record)
        .filter((entry) => entry?.id
            && entry.id !== record?.id
            && usefulLifeRegisterClassKey(entry.itemName) === matchKey)
        .map((entry) => entry.id);
}

/**
 * 같은 분류명 형제 — 대장 분류명 + 매칭 분류명(미고시 포함) + 분류번호로 묶는다.
 * 예전에는 record.goodsClNm만 봐서, 미고시 매칭명만 같은 항목이 빠졌다.
 */
function findSameClassRegisterIds(record, options = {}) {
    const selfLife = options.life || usefulLifeRegisterCacheLife(record);
    const self = usefulLifeRegisterEffectiveClass(record, selfLife);
    const key = options.sameClassKey || self.key;
    const code = String(options.sameClassCode || self.code || '').replace(/\D/g, '');
    if (!key && !code) return [];

    const pool = ulRegisterCache.length
        ? ulRegisterCache
        : usefulLifeRegisterPool(record).map((entry) => ({
            record: entry,
            life: typeof describeRegisterUsefulLife === 'function'
                ? describeRegisterUsefulLife(entry)
                : null
        }));

    return pool
        .filter(({ record: entry, life }) => {
            if (!entry?.id || entry.id === record?.id) return false;
            if (record?.surveyId && entry.surveyId && entry.surveyId !== record.surveyId) return false;
            const eff = usefulLifeRegisterEffectiveClass(entry, life);
            if (code && eff.code && eff.code === code) return true;
            if (key && eff.key && eff.key === key) return true;
            return false;
        })
        .map(({ record: entry }) => entry.id);
}

/** 체크된 물품명·분류명 조건을 합쳐 일괄 변경 대상 ID를 모은다 */
function collectSiblingRegisterIds(record, options = {}) {
    const ids = new Set();
    const itemKey = options.sameItemKey || usefulLifeRegisterClassKey(record?.itemName);
    const life = options.life || usefulLifeRegisterCacheLife(record);
    const eff = usefulLifeRegisterEffectiveClass(record, life);
    const classKey = options.sameClassKey || eff.key;
    const classCode = options.sameClassCode || eff.code;

    if (options.applySameItem && itemKey) {
        findSameItemRegisterIds(record, itemKey).forEach((id) => ids.add(id));
    }
    if (options.applySameClass && (classKey || classCode)) {
        findSameClassRegisterIds(record, {
            life,
            sameClassKey: classKey,
            sameClassCode: classCode
        }).forEach((id) => ids.add(id));
    }
    return [...ids];
}

function renderUsefulLifeRegisterPickerContext(record, life) {
    const el = document.getElementById('usefulLifePickerContext');
    if (!el) return;

    const rows = [
        ['물품명', record?.itemName],
        ['분류명', record?.goodsClNm],
        ['분류번호', record?.goodsClNo],
        ['규격', record?.model],
        ['계정과목', record?.category]
    ].filter(([, value]) => String(value || '').trim());

    const catalogCode = record?.goodsClNo
        || life?.goodsClNo
        || life?.candidates?.[0]?.goodsClNo
        || '';
    const catalog = typeof lookupGoodsCatalogByCode === 'function'
        ? lookupGoodsCatalogByCode(catalogCode)
        : (typeof lookupGoodsCatalogByName === 'function'
            ? lookupGoodsCatalogByName(record?.goodsClNm || record?.itemName || '').entry
            : null);

    if (catalog?.engNm) rows.push(['영문품명', catalog.engNm]);
    if (catalog?.explain) rows.push(['분류해설', catalog.explain]);

    const linkCode = catalog?.goodsClNo || catalogCode;
    const linkQuery = record?.goodsClNm || record?.itemName || '';
    const links = [];
    if (typeof goodsCatalogDetailUrl === 'function' && linkCode) {
        links.push(`<a href="${escapeUlRegisterHtml(goodsCatalogDetailUrl(linkCode))}" target="_blank" rel="noopener noreferrer">목록정보 상세</a>`);
    }
    if (typeof goodsCatalogSearchUrl === 'function' && linkQuery) {
        links.push(`<a href="${escapeUlRegisterHtml(goodsCatalogSearchUrl(linkQuery))}" target="_blank" rel="noopener noreferrer">목록정보 검색</a>`);
    }

    if (!rows.length && !links.length) {
        el.hidden = true;
        el.innerHTML = '';
        return;
    }

    el.hidden = false;
    el.innerHTML = `
        ${rows.map(([label, value]) => `
            <div class="ul-picker-context-row">
                <span class="ul-picker-context-label">${escapeUlRegisterHtml(label)}</span>
                <span class="ul-picker-context-value">${escapeUlRegisterHtml(value)}</span>
            </div>
        `).join('')}
        ${links.length ? `<div class="ul-picker-context-links">${links.join(' · ')}</div>` : ''}
    `;
}

function renderUsefulLifeRegisterRows(rows) {
    const body = document.getElementById('ulRegisterTableBody');
    const empty = document.getElementById('ulRegisterEmpty');
    const wrap = document.getElementById('ulRegisterTableWrap');
    const count = document.getElementById('ulRegisterCount');
    if (!body) return;

    if (!ulRegisterCache.length) {
        body.innerHTML = '';
        if (wrap) wrap.hidden = true;
        if (empty) {
            empty.hidden = false;
            empty.textContent = '대장을 보려면 조사 회차를 선택하고, 관리 탭에서 대장 엑셀을 올리세요.';
        }
        if (count) count.textContent = '';
        return;
    }

    if (!rows.length) {
        body.innerHTML = '';
        if (wrap) wrap.hidden = true;
        if (empty) {
            empty.hidden = false;
            empty.textContent = '조건에 맞는 대장 항목이 없습니다.';
        }
        if (count) count.textContent = `0 / ${ulRegisterCache.length}건`;
        return;
    }

    if (empty) empty.hidden = true;
    if (wrap) wrap.hidden = false;

    const visible = rows.slice(0, ulRegisterVisible);
    body.innerHTML = visible.map(({ record, life }) => {
        const verdict = life.verdict || 'missing';
        const label = typeof usefulLifeVerdictLabelKo === 'function'
            ? usefulLifeVerdictLabelKo(verdict)
            : verdict;
        const years = life.entry || life.usefulLife
            ? (life.notified && life.usefulLife > 0 ? `${life.usefulLife}년` : '미고시')
            : '-';
        const registerClass = record.goodsClNm || '';
        const matchedClass = life.goodsClNm || '';
        const showMatched = matchedClass
            && normalizeGoodsName?.(matchedClass) !== normalizeGoodsName?.(registerClass);
        const cls = usefulLifeRegisterStatusClass(verdict);
        const id = escapeUlRegisterHtml(record.id);
        const actions = verdict === 'ambiguous' || verdict === 'missing'
            ? `<button type="button" class="btn btn-secondary btn-small" data-ul-register-pick="${id}">고르기</button>`
            : `<button type="button" class="btn btn-secondary btn-small" data-ul-register-pick="${id}">변경</button>`;
        return `
            <tr>
                <td><span class="register-status ${cls}">${escapeUlRegisterHtml(label)}</span></td>
                <td class="register-cell-asset">${escapeUlRegisterHtml(record.assetNumber || '-')}</td>
                <td class="register-cell-name">${escapeUlRegisterHtml(record.itemName || '이름 없음')}</td>
                <td class="register-cell-class">
                    <span>${escapeUlRegisterHtml(registerClass || matchedClass || '-')}</span>
                    ${(record.goodsClNo || life.goodsClNo)
                        ? `<small class="ul-register-code">${escapeUlRegisterHtml(record.goodsClNo || life.goodsClNo)}</small>`
                        : ''}
                    ${showMatched ? `<small class="ul-matched-class">매칭: ${escapeUlRegisterHtml(matchedClass)}</small>` : ''}
                </td>
                <td class="register-cell-spec" title="${escapeUlRegisterHtml(record.model || '')}">${escapeUlRegisterHtml(record.model || '-')}</td>
                <td class="col-optional">${escapeUlRegisterHtml(record.category || '-')}</td>
                <td>${escapeUlRegisterHtml(years)}</td>
                <td class="col-optional">${escapeUlRegisterHtml(record.acquiredAt || '-')}</td>
                <td class="col-optional">${escapeUlRegisterHtml(life.expiry || life.label || '-')}</td>
                <td class="register-cell-actions">${actions}</td>
            </tr>
        `;
    }).join('');

    if (count) {
        count.textContent = visible.length < rows.length
            ? `${visible.length} / ${rows.length}건 표시 · 전체 대장 ${ulRegisterCache.length}건`
            : `${rows.length}건 · 전체 대장 ${ulRegisterCache.length}건`;
    }

    if (visible.length < rows.length) {
        const more = document.createElement('tr');
        more.innerHTML = `<td colspan="10" style="text-align:center;padding:16px;">
            <button type="button" class="btn btn-secondary btn-small" id="ulRegisterLoadMore">더 보기</button>
        </td>`;
        body.appendChild(more);
        more.querySelector('#ulRegisterLoadMore')?.addEventListener('click', () => {
            ulRegisterVisible += UL_REGISTER_PAGE_SIZE;
            renderUsefulLifeRegisterRows(rows);
        });
    }
}

async function refreshUsefulLifeRegisterTab() {
    if (typeof ensureUsefulLifeTable === 'function') {
        await ensureUsefulLifeTable();
    }
    if (typeof ensureGoodsCatalog === 'function') {
        await ensureGoodsCatalog();
    }
    ulRegisterCache = buildUsefulLifeRegisterCache();
    updateUsefulLifeRegisterStats(ulRegisterCache);
    const filtered = filterUsefulLifeRegisterRows(ulRegisterCache);
    renderUsefulLifeRegisterRows(filtered);
}

function enrichUsefulLifeRegisterCandidates(record, life, seed) {
    const candidates = [...(seed || [])];
    const push = (candidate) => {
        if (!candidate?.goodsClNo) return;
        if (candidates.some((item) => item.goodsClNo === candidate.goodsClNo)) return;
        candidates.push(candidate);
    };

    if (life?.entry) {
        push({
            goodsClNo: life.goodsClNo,
            goodsClNm: life.goodsClNm,
            usefulLife: life.usefulLife,
            notified: life.notified,
            catalogExplain: life.catalogExplain,
            catalogEngNm: life.catalogEngNm
        });
    }
    (life?.candidates || []).forEach(push);

    if (typeof searchUsefulLifeClasses === 'function') {
        searchUsefulLifeClasses(usefulLifeRegisterSearchQuery(record), 8).forEach(push);
    }
    // 고르기 모달에서만 목록정보 검색(1회). contain 모드로 후보를 넓힌다.
    if (typeof searchGoodsCatalog === 'function' && typeof usefulLifeCandidateFromCatalog === 'function') {
        searchGoodsCatalog(usefulLifeRegisterSearchQuery(record), 8, { mode: 'contain' })
            .map((entry) => usefulLifeCandidateFromCatalog(entry, entry.score))
            .filter(Boolean)
            .forEach(push);
    }

    return candidates.slice(0, 12).map((candidate) => {
        const catalog = typeof lookupGoodsCatalogByCode === 'function'
            ? lookupGoodsCatalogByCode(candidate.goodsClNo)
            : null;
        return {
            ...candidate,
            catalogExplain: candidate.catalogExplain || catalog?.explain || '',
            catalogEngNm: candidate.catalogEngNm || catalog?.engNm || ''
        };
    });
}

function renderUsefulLifeRegisterCandidateButtons(candidates) {
    return candidates.map((candidate, index) => {
        const years = candidate.notified && candidate.usefulLife > 0 ? `${candidate.usefulLife}년` : '미고시';
        const explain = candidate.catalogExplain
            ? `<small class="ul-candidate-explain">${escapeUlRegisterHtml(candidate.catalogExplain)}</small>`
            : '';
        const eng = candidate.catalogEngNm
            ? `<em class="ul-candidate-eng">${escapeUlRegisterHtml(candidate.catalogEngNm)}</em>`
            : '';
        return `
            <button type="button" class="ul-candidate" data-ul-pick="${index}">
                <span class="ul-candidate-name">${escapeUlRegisterHtml(candidate.goodsClNm)}</span>
                ${eng}
                ${explain}
                <span class="ul-candidate-meta">
                    <strong>${escapeUlRegisterHtml(years)}</strong>
                    <em>${candidate.notified ? '고시' : '미고시'}</em>
                    <small>${escapeUlRegisterHtml(candidate.goodsClNo)}</small>
                </span>
            </button>
        `;
    }).join('');
}

async function openUsefulLifeRegisterPicker(registerId) {
    const row = ulRegisterCache.find((entry) => entry.record.id === registerId);
    if (!row) return;
    const { record, life } = row;

    if (typeof ensureGoodsCatalog === 'function') {
        await ensureGoodsCatalog();
    }

    const candidates = enrichUsefulLifeRegisterCandidates(record, life);

    const modal = document.getElementById('usefulLifePickerModal');
    const list = document.getElementById('usefulLifePickerList');
    const title = document.getElementById('usefulLifePickerTitle');
    const search = document.getElementById('usefulLifeSearch');
    const learn = document.getElementById('usefulLifeLearnSame');
    if (!modal || !list) {
        showToast('분류 선택 UI를 열 수 없습니다', 'error');
        return;
    }

    if (title) title.textContent = usefulLifeRegisterPickerTitle(record);
    renderUsefulLifeRegisterPickerContext(record, life);
    if (learn) learn.checked = true;

    const itemLabel = String(record.itemName || '').trim();
    const effClass = usefulLifeRegisterEffectiveClass(record, life);
    const itemIds = findSameItemRegisterIds(record);
    const classIds = findSameClassRegisterIds(record, { life });
    if (typeof setUsefulLifeApplySameGroupUi === 'function') {
        setUsefulLifeApplySameGroupUi({
            enabled: true,
            itemLabel,
            classLabel: effClass.label,
            classCode: effClass.code,
            itemCount: itemIds.length,
            classCount: classIds.length
        });
    } else if (typeof setUsefulLifeApplySameClassUi === 'function') {
        setUsefulLifeApplySameClassUi({
            enabled: true,
            itemLabel,
            classLabel: effClass.label,
            classCode: effClass.code,
            itemCount: itemIds.length,
            classCount: classIds.length
        });
    }
    list.dataset.ulSameClassCode = effClass.code || '';

    if (search) {
        search.value = usefulLifeRegisterSpecHead(record)
            || record.goodsClNm
            || record.itemName
            || '';
    }
    if (typeof clearUsefulLifeDirectFields === 'function') clearUsefulLifeDirectFields();

    list.dataset.ulCandidates = JSON.stringify(candidates);
    list.dataset.ulRegisterId = registerId;
    list.innerHTML = renderUsefulLifeRegisterCandidateButtons(candidates);

    const empty = document.getElementById('usefulLifePickerEmpty');
    if (empty) {
        empty.hidden = candidates.length > 0;
        empty.textContent = candidates.length
            ? ''
            : '후보가 없습니다. 아래에서 품명이나 분류번호를 직접 입력하세요.';
    }

    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
}

async function applyUsefulLifeRegisterPick(registerId, candidate, learn, options = {}) {
    if (!registerId || !candidate || typeof updateRegisterRecord !== 'function') return;
    const patch = {
        goodsClNo: candidate.goodsClNo,
        goodsClNm: candidate.goodsClNm,
        usefulLife: Number(candidate.usefulLife) || 0,
        usefulLifeMatch: 'pick',
        usefulLifeUpdatedAt: new Date().toISOString()
    };

    const record = (typeof registerItems !== 'undefined' ? registerItems : [])
        .find((entry) => entry.id === registerId)
        || ulRegisterCache.find((entry) => entry.record.id === registerId)?.record;

    const applySameItem = options.applySameItem === true
        || (options.applySameItem == null
            && document.getElementById('usefulLifeApplySameItem')?.checked === true);
    const applySameClass = options.applySameClass === true
        || (options.applySameClass == null
            && document.getElementById('usefulLifeApplySameClass')?.checked === true);
    const life = usefulLifeRegisterCacheLife(record);
    const effClass = usefulLifeRegisterEffectiveClass(record, life);
    const sameItemKey = options.sameItemKey || usefulLifeRegisterClassKey(record?.itemName);
    const sameClassKey = options.sameClassKey || effClass.key;
    const sameClassCode = options.sameClassCode
        || document.getElementById('usefulLifePickerList')?.dataset.ulSameClassCode
        || effClass.code;

    const itemSiblingIds = applySameItem && sameItemKey
        ? findSameItemRegisterIds(record, sameItemKey)
        : [];
    const classSiblingIds = applySameClass && (sameClassKey || sameClassCode)
        ? findSameClassRegisterIds(record, {
            life,
            sameClassKey,
            sameClassCode
        })
        : [];
    const siblingIds = collectSiblingRegisterIds(record, {
        applySameItem,
        applySameClass,
        sameItemKey,
        sameClassKey,
        sameClassCode,
        life
    });

    // 현재 행과 형제를 한 번에 저장해야 청크/문서 폴백이 동일하게 적용된다
    const allEntries = [
        { registerId, patch },
        ...siblingIds.map((id) => ({ registerId: id, patch }))
    ];
    let siblingUpdated = 0;
    if (typeof updateRegisterRecordsBulk === 'function' && allEntries.length > 1) {
        const result = await updateRegisterRecordsBulk(allEntries);
        siblingUpdated = Math.max(0, (Number(result?.updated) || allEntries.length) - 1);
    } else {
        await updateRegisterRecord(registerId, patch);
        for (const id of siblingIds) {
            await updateRegisterRecord(id, patch);
            siblingUpdated += 1;
        }
    }

    // 형제 일괄 변경 시에도 품명별 학습 사전을 같이 갱신해야
    // 미고시 목록/엑셀 재적용이 대장(register) pick과 어긋나지 않는다.
    if (learn !== false && typeof saveUsefulLifeAlias === 'function') {
        const aliasNameKeys = new Set();
        if (record?.itemName) aliasNameKeys.add(String(record.itemName).trim());
        const registerList = typeof registerItems !== 'undefined' ? registerItems : [];
        for (const id of siblingIds) {
            const sibling = registerList.find((entry) => entry.id === id)
                || ulRegisterCache.find((entry) => entry.record.id === id)?.record;
            const name = sibling?.itemName ? String(sibling.itemName).trim() : '';
            if (name) aliasNameKeys.add(name);
        }
        for (const nameKey of aliasNameKeys) {
            await saveUsefulLifeAlias({
                nameKey,
                goodsClNo: patch.goodsClNo,
                goodsClNm: patch.goodsClNm,
                usefulLife: patch.usefulLife
            });
        }
    }
    if (typeof showToast === 'function') {
        const parts = [];
        if (applySameItem && itemSiblingIds.length) parts.push(`물품명 ${itemSiblingIds.length}`);
        if (applySameClass && classSiblingIds.length) parts.push(`분류명 ${classSiblingIds.length}`);
        const note = siblingUpdated
            ? ` · ${siblingUpdated}건 함께 변경${parts.length ? ` (${parts.join(' + ')})` : ''}`
            : '';
        showToast(`"${patch.goodsClNm}" 적용${note}`, 'success');
    }
    await refreshUsefulLifeRegisterTab();
}

function bindUsefulLifeRegisterTab() {
    if (ulRegisterBound) return;
    ulRegisterBound = true;

    document.getElementById('ulRegisterFilters')?.addEventListener('click', (event) => {
        const btn = event.target.closest('[data-ul-filter]');
        if (!btn) return;
        ulRegisterFilter = btn.dataset.ulFilter || 'all';
        ulRegisterVisible = UL_REGISTER_PAGE_SIZE;
        document.querySelectorAll('#ulRegisterFilters [data-ul-filter]').forEach((el) => {
            el.classList.toggle('active', el === btn);
        });
        renderUsefulLifeRegisterRows(filterUsefulLifeRegisterRows(ulRegisterCache));
    });

    document.getElementById('ulRegisterSearch')?.addEventListener('input', (event) => {
        clearTimeout(ulRegisterSearchTimer);
        ulRegisterSearchTimer = setTimeout(() => {
            ulRegisterSearch = event.target.value || '';
            ulRegisterVisible = UL_REGISTER_PAGE_SIZE;
            renderUsefulLifeRegisterRows(filterUsefulLifeRegisterRows(ulRegisterCache));
        }, 200);
    });

    document.getElementById('exportUsefulLifeRegisterExcel')?.addEventListener('click', () => {
        if (typeof exportUsefulLifeRegisterExcel === 'function') exportUsefulLifeRegisterExcel();
    });

    const importBtn = document.getElementById('importUsefulLifeRegisterBtn');
    const importInput = document.getElementById('importUsefulLifeRegisterFile');
    if (importBtn && importInput) {
        importBtn.addEventListener('click', () => importInput.click());
        importInput.addEventListener('change', async (event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file || typeof importUsefulLifeExcelFile !== 'function') return;
            try {
                await importUsefulLifeExcelFile(file, { target: 'register' });
            } catch (error) {
                console.error('대장 내용연수 반영 실패:', error);
                showToast(error?.message || '대장 선택분류 반영에 실패했습니다', 'error');
            }
        });
    }

    document.getElementById('ulRegisterUploadHintBtn')?.addEventListener('click', () => {
        if (typeof switchTab === 'function') switchTab('manage');
        setTimeout(() => document.getElementById('importRegisterBtn')?.scrollIntoView({ behavior: 'smooth' }), 100);
    });

    document.getElementById('ulRegisterTableBody')?.addEventListener('click', (event) => {
        const btn = event.target.closest('[data-ul-register-pick]');
        if (!btn) return;
        openUsefulLifeRegisterPicker(btn.dataset.ulRegisterPick);
    });

    // 기존 분류 고르기 모달에서 대장 ID가 있으면 대장에 저장
    document.getElementById('usefulLifePickerList')?.addEventListener('click', async (event) => {
        const pick = event.target.closest('[data-ul-pick]');
        const list = document.getElementById('usefulLifePickerList');
        const registerId = list?.dataset.ulRegisterId;
        if (!pick || !registerId) return;

        event.stopImmediatePropagation();
        let candidates = [];
        try {
            candidates = JSON.parse(list.dataset.ulCandidates || '[]');
        } catch (error) {
            candidates = [];
        }
        const candidate = candidates[Number(pick.dataset.ulPick)];
        const learn = document.getElementById('usefulLifeLearnSame')?.checked !== false;
        const sameOptions = typeof readUsefulLifeSameGroupOptions === 'function'
            ? readUsefulLifeSameGroupOptions()
            : {
                applySameItem: document.getElementById('usefulLifeApplySameItem')?.checked === true,
                applySameClass: document.getElementById('usefulLifeApplySameClass')?.checked === true,
                sameItemKey: list.dataset.ulSameItemKey || '',
                sameClassKey: list.dataset.ulSameClassKey || '',
                sameClassCode: list.dataset.ulSameClassCode || ''
            };
        list.dataset.ulRegisterId = '';
        if (typeof closeUsefulLifePicker === 'function') closeUsefulLifePicker();
        else {
            document.getElementById('usefulLifePickerModal')?.classList.remove('show');
            document.body.style.overflow = 'auto';
        }
        if (candidate) {
            await applyUsefulLifeRegisterPick(registerId, candidate, learn, sameOptions);
        }
    }, true);
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindUsefulLifeRegisterTab);
    } else {
        bindUsefulLifeRegisterTab();
    }
}

window.refreshUsefulLifeRegisterTab = refreshUsefulLifeRegisterTab;
window.bindUsefulLifeRegisterTab = bindUsefulLifeRegisterTab;

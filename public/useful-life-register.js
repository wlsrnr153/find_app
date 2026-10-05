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

function describeRegisterUsefulLife(record) {
    if (typeof describeUsefulLife !== 'function') {
        return { verdict: 'missing', note: '내용연수 엔진 없음', candidates: [] };
    }
    return describeUsefulLife({
        itemName: record.itemName,
        goodsClNo: record.goodsClNo,
        acquiredAt: record.acquiredAt
    });
}

function buildUsefulLifeRegisterCache() {
    const register = typeof getRegisterForSurvey === 'function' ? getRegisterForSurvey() : [];
    return register.map((record) => {
        const life = describeRegisterUsefulLife(record);
        const haystack = [
            record.assetNumber, record.itemName, record.goodsClNm, life.goodsClNm,
            record.location, record.category, usefulLifeVerdictLabelKo?.(life.verdict)
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
    return filtered;
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
                <td>${escapeUlRegisterHtml(life.goodsClNm || record.goodsClNm || '-')}</td>
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
        more.innerHTML = `<td colspan="8" style="text-align:center;padding:16px;">
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
    ulRegisterCache = buildUsefulLifeRegisterCache();
    updateUsefulLifeRegisterStats(ulRegisterCache);
    const filtered = filterUsefulLifeRegisterRows(ulRegisterCache);
    renderUsefulLifeRegisterRows(filtered);
}

async function openUsefulLifeRegisterPicker(registerId) {
    const row = ulRegisterCache.find((entry) => entry.record.id === registerId);
    if (!row) return;
    const { record, life } = row;
    const candidates = [];
    if (life.entry) {
        candidates.push({
            goodsClNo: life.goodsClNo,
            goodsClNm: life.goodsClNm,
            usefulLife: life.usefulLife,
            notified: life.notified
        });
    }
    (life.candidates || []).forEach((candidate) => {
        if (!candidates.some((item) => item.goodsClNo === candidate.goodsClNo)) {
            candidates.push(candidate);
        }
    });

    if (!candidates.length && typeof searchUsefulLifeClasses === 'function') {
        candidates.push(...searchUsefulLifeClasses(record.itemName || '', 8));
    }
    if (!candidates.length) {
        const modal = document.getElementById('usefulLifePickerModal');
        const list = document.getElementById('usefulLifePickerList');
        const title = document.getElementById('usefulLifePickerTitle');
        if (!modal || !list) {
            showToast('분류 선택 UI를 열 수 없습니다', 'error');
            return;
        }
        if (title) title.textContent = `"${record.itemName || '대장 항목'}" 분류 고르기`;
        if (typeof clearUsefulLifeDirectFields === 'function') clearUsefulLifeDirectFields();
        list.dataset.ulCandidates = '[]';
        list.dataset.ulRegisterId = registerId;
        list.innerHTML = '';
        const empty = document.getElementById('usefulLifePickerEmpty');
        if (empty) {
            empty.hidden = false;
            empty.textContent = '후보가 없습니다. 아래에서 품명이나 분류번호를 직접 입력하세요.';
        }
        modal.classList.add('show');
        document.body.style.overflow = 'hidden';
        return;
    }

    // 간단 선택: 상위 후보를 confirm 체인 대신 모달 리스트 재사용
    const modal = document.getElementById('usefulLifePickerModal');
    const list = document.getElementById('usefulLifePickerList');
    const title = document.getElementById('usefulLifePickerTitle');
    const search = document.getElementById('usefulLifeSearch');
    const learn = document.getElementById('usefulLifeLearnSame');
    if (!modal || !list) {
        showToast('분류 선택 UI를 열 수 없습니다', 'error');
        return;
    }

    if (title) title.textContent = `"${record.itemName || '대장 항목'}" 분류 고르기`;
    if (learn) learn.checked = true;
    if (search) search.value = '';
    clearUsefulLifeDirectFields();

    list.dataset.ulCandidates = JSON.stringify(candidates);
    list.dataset.ulRegisterId = registerId;
    list.innerHTML = candidates.map((candidate, index) => {
        const years = candidate.notified && candidate.usefulLife > 0 ? `${candidate.usefulLife}년` : '미고시';
        return `
            <button type="button" class="ul-candidate" data-ul-pick="${index}">
                <span class="ul-candidate-name">${escapeUlRegisterHtml(candidate.goodsClNm)}</span>
                <span class="ul-candidate-meta">
                    <strong>${escapeUlRegisterHtml(years)}</strong>
                    <em>${candidate.notified ? '고시' : '미고시'}</em>
                    <small>${escapeUlRegisterHtml(candidate.goodsClNo)}</small>
                </span>
            </button>
        `;
    }).join('');

    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
}

async function applyUsefulLifeRegisterPick(registerId, candidate, learn) {
    if (!registerId || !candidate || typeof updateRegisterRecord !== 'function') return;
    const patch = {
        goodsClNo: candidate.goodsClNo,
        goodsClNm: candidate.goodsClNm,
        usefulLife: Number(candidate.usefulLife) || 0,
        usefulLifeMatch: 'pick',
        usefulLifeUpdatedAt: new Date().toISOString()
    };
    await updateRegisterRecord(registerId, patch);

    const record = (typeof registerItems !== 'undefined' ? registerItems : [])
        .find((entry) => entry.id === registerId);
    if (learn !== false && record?.itemName && typeof saveUsefulLifeAlias === 'function') {
        await saveUsefulLifeAlias({
            nameKey: record.itemName,
            goodsClNo: patch.goodsClNo,
            goodsClNm: patch.goodsClNm,
            usefulLife: patch.usefulLife
        });
    }
    if (typeof showToast === 'function') {
        showToast(`"${patch.goodsClNm}" 적용`, 'success');
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
        list.dataset.ulRegisterId = '';
        if (typeof closeUsefulLifePicker === 'function') closeUsefulLifePicker();
        else {
            document.getElementById('usefulLifePickerModal')?.classList.remove('show');
            document.body.style.overflow = 'auto';
        }
        if (candidate) await applyUsefulLifeRegisterPick(registerId, candidate, learn);
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

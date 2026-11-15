// 회차별 입력폼 스키마 — 대장 엑셀 매핑 결과를 입력 항목으로 사용

const FORM_SCHEMA_STORAGE_PREFIX = 'formSchema_';
const FORM_SCHEMA_ALWAYS = [
    { key: 'surveyor', label: '조사자', required: true, core: true, source: 'system', showInForm: true, compare: false, type: 'text' },
    { key: 'condition', label: '상태(실사)', required: false, core: false, source: 'system', showInForm: true, compare: false, type: 'select' },
    { key: 'notes', label: '비고', required: false, core: false, source: 'system', showInForm: true, compare: false, type: 'textarea', optionalGroup: true }
];

const FORM_SCHEMA_SYSTEM_META = {
    assetNumber: { type: 'text', core: true, optionalGroup: false, compare: false },
    itemName: { type: 'text', core: true, optionalGroup: false, compare: true },
    organization: { type: 'text', core: false, optionalGroup: false, compare: true },
    holder: { type: 'text', core: false, optionalGroup: false, compare: true },
    location: { type: 'text', core: false, optionalGroup: false, compare: true },
    building: { type: 'text', core: false, optionalGroup: false, compare: false },
    floor: { type: 'text', core: false, optionalGroup: false, compare: false },
    room: { type: 'text', core: false, optionalGroup: false, compare: false },
    goodsClNm: { type: 'text', core: false, optionalGroup: true, compare: true },
    goodsClNo: { type: 'hidden', core: false, optionalGroup: true, compare: false },
    category: { type: 'select', core: false, optionalGroup: true, compare: true },
    quantity: { type: 'number', core: false, optionalGroup: false, compare: true },
    acquiredAt: { type: 'date', core: false, optionalGroup: true, compare: true },
    usefulLife: { type: 'usefulLife', core: false, optionalGroup: true, compare: false },
    manufacturer: { type: 'text', core: false, optionalGroup: true, compare: true },
    model: { type: 'text', core: false, optionalGroup: true, compare: true },
    condition: { type: 'select', core: false, optionalGroup: true, compare: true }
};

const FORM_BUILTIN_DATA_FIELDS = [
    'surveyor', 'organization', 'location', 'itemName', 'assetNumber', 'holder', 'quantity',
    'acquiredAt', 'usefulLife', 'category', 'manufacturer', 'model', 'dimensions',
    'color', 'material', 'condition', 'notes'
];

let activeFormSchema = null;
let activeFormSchemaSignature = '';

function formSchemaSignature(schema) {
    if (!schema?.fields?.length) return '';
    return schema.fields.map((f) => [
        f.key,
        f.label || '',
        f.showInForm === false ? '0' : '1',
        f.compare ? '1' : '0',
        f.excelHeader || ''
    ].join(':')).join('|');
}

function customFieldKeyFromHeader(header) {
    const normalized = typeof normalizeHeader === 'function'
        ? normalizeHeader(header)
        : String(header || '').trim().toLowerCase().replace(/[\s\-_.()\[\]]/g, '');
    return `custom_${normalized || 'field'}`;
}

function getSurveyFormSchema(surveyId) {
    const sid = surveyId || (typeof getWritableSurvey === 'function' ? getWritableSurvey()?.id : '') || '';
    if (!sid) return null;
    if (typeof surveys !== 'undefined' && Array.isArray(surveys)) {
        const survey = surveys.find((entry) => entry.id === sid);
        if (survey?.formSchema?.fields?.length) return survey.formSchema;
    }
    try {
        const raw = localStorage.getItem(FORM_SCHEMA_STORAGE_PREFIX + sid);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed?.fields?.length) return parsed;
        }
    } catch (e) { /* ignore */ }
    return null;
}

function buildFormSchemaFromMapping(mapping = {}, headers = [], rows = [], previousSelections = null) {
    const usedHeaders = new Set(Object.values(mapping || {}).filter(Boolean));
    const fields = [];
    const prevByKey = {};
    (previousSelections?.fields || []).forEach((field) => {
        if (field?.key) prevByKey[field.key] = field;
    });

    FORM_SCHEMA_ALWAYS.filter((f) => f.key === 'surveyor').forEach((field) => {
        fields.push({ ...field, order: fields.length });
    });

    const systemFields = (typeof REGISTER_SYSTEM_FIELDS !== 'undefined' ? REGISTER_SYSTEM_FIELDS : []);
    systemFields.forEach((field) => {
        const header = mapping[field.key];
        if (!header) return;
        const meta = FORM_SCHEMA_SYSTEM_META[field.key] || { type: 'text', core: false, optionalGroup: true, compare: true };
        const prev = prevByKey[field.key];
        fields.push({
            key: field.key,
            label: header,
            systemLabel: field.label,
            excelHeader: header,
            type: meta.type,
            required: !!field.required,
            core: !!meta.core || !!field.required,
            source: 'mapped',
            showInForm: prev?.showInForm !== false,
            compare: prev?.compare != null ? !!prev.compare : !!meta.compare,
            optionalGroup: !!meta.optionalGroup,
            order: fields.length
        });
    });

    // 건물/층/실만 매핑된 경우에도 입력폼에는 단일 사용위치로 표시
    if (!fields.some((f) => f.key === 'location')
        && (mapping.building || mapping.floor || mapping.room || mapping.location)) {
        fields.push({
            key: 'location',
            label: mapping.location || '사용위치',
            systemLabel: '사용위치',
            excelHeader: mapping.location || '',
            type: 'text',
            required: false,
            core: false,
            source: mapping.location ? 'mapped' : 'derived',
            showInForm: true,
            compare: true,
            optionalGroup: false,
            order: fields.length
        });
    }
    // 분리된 건물/층/실은 입력폼에서 숨김 (단일 location으로 합침)
    fields.forEach((field) => {
        if (['building', 'floor', 'room'].includes(field.key)) {
            field.showInForm = false;
            field.compare = false;
        }
    });

    if (!fields.some((f) => f.key === 'condition')) {
        const conditionField = FORM_SCHEMA_ALWAYS.find((f) => f.key === 'condition');
        fields.push({ ...conditionField, order: fields.length });
    }

    headers.forEach((header) => {
        if (!header || usedHeaders.has(header)) return;
        const key = customFieldKeyFromHeader(header);
        const prev = prevByKey[key];
        const fill = typeof headerFillRate === 'function' ? headerFillRate(rows, header) : 0;
        fields.push({
            key,
            label: header,
            excelHeader: header,
            type: 'text',
            required: false,
            core: false,
            source: 'extra',
            custom: true,
            showInForm: prev?.showInForm != null ? !!prev.showInForm : fill >= 0.2,
            compare: prev?.compare != null ? !!prev.compare : fill >= 0.2,
            optionalGroup: true,
            order: fields.length
        });
    });

    const notesField = FORM_SCHEMA_ALWAYS.find((f) => f.key === 'notes');
    if (notesField && !fields.some((f) => f.key === 'notes')) {
        const prev = prevByKey.notes;
        fields.push({
            ...notesField,
            showInForm: prev?.showInForm !== false,
            order: fields.length
        });
    }

    return {
        version: 1,
        source: 'register-mapping',
        updatedAt: new Date().toISOString(),
        fields
    };
}

function syncPendingFormFieldSelections() {
    const pending = typeof pendingRegisterImport !== 'undefined' ? pendingRegisterImport : null;
    if (!pending) return;
    const box = document.getElementById('registerFormSchemaFields');
    if (!box) return;
    const selections = {};
    box.querySelectorAll('[data-schema-key]').forEach((row) => {
        const key = row.dataset.schemaKey;
        selections[key] = {
            showInForm: !!row.querySelector('[data-schema-show]')?.checked,
            compare: !!row.querySelector('[data-schema-compare]')?.checked
        };
    });
    if (!pending.formSchema) {
        pending.formSchema = buildFormSchemaFromMapping(
            pending.mapping,
            pending.headers,
            pending.rows,
            null
        );
    }
    pending.formSchema.fields = (pending.formSchema.fields || []).map((field) => {
        const sel = selections[field.key];
        if (!sel) return field;
        return { ...field, showInForm: sel.showInForm, compare: sel.compare };
    });
}

function renderRegisterFormSchemaSection() {
    const pending = typeof pendingRegisterImport !== 'undefined' ? pendingRegisterImport : null;
    const host = document.getElementById('registerFormSchemaSection');
    if (!pending || !host) return;

    pending.formSchema = buildFormSchemaFromMapping(
        pending.mapping,
        pending.headers,
        pending.rows,
        pending.formSchema
    );

    const visibleFields = pending.formSchema.fields.filter((f) => f.source !== 'system' || f.key === 'notes' || f.key === 'condition');
    host.innerHTML = `
        <h3 class="form-section-title">입력폼에 쓸 항목</h3>
        <p class="register-map-summary">체크한 항목만 입력 탭에 표시됩니다. 라벨은 엑셀 열 이름을 따릅니다.</p>
        <div id="registerFormSchemaFields" class="register-form-schema-fields">
            ${visibleFields.map((field) => `
                <div class="register-form-schema-row" data-schema-key="${escapeHtml(field.key)}">
                    <span class="register-form-schema-label">${escapeHtml(field.label)}${field.systemLabel && field.systemLabel !== field.label ? ` <small>(${escapeHtml(field.systemLabel)})</small>` : ''}</span>
                    <label class="register-form-schema-check"><input type="checkbox" data-schema-show ${field.showInForm ? 'checked' : ''}> 입력</label>
                    <label class="register-form-schema-check"><input type="checkbox" data-schema-compare ${field.compare ? 'checked' : ''} ${field.key === 'assetNumber' || field.key === 'surveyor' ? 'disabled' : ''}> 비교</label>
                </div>
            `).join('')}
        </div>
    `;
    host.querySelectorAll('input[type="checkbox"]').forEach((input) => {
        input.addEventListener('change', syncPendingFormFieldSelections);
    });
}

async function saveFormSchemaToSurvey(surveyId, schema) {
    if (!surveyId || !schema?.fields?.length) return;
    const clean = {
        version: schema.version || 1,
        source: schema.source || 'register-mapping',
        updatedAt: new Date().toISOString(),
        fields: schema.fields.map((field, index) => ({
            key: field.key,
            label: field.label,
            systemLabel: field.systemLabel || '',
            excelHeader: field.excelHeader || '',
            type: field.type || 'text',
            required: !!field.required,
            core: !!field.core,
            source: field.source || 'mapped',
            custom: !!field.custom,
            showInForm: field.showInForm !== false,
            compare: !!field.compare,
            optionalGroup: !!field.optionalGroup,
            order: field.order != null ? field.order : index
        }))
    };

    try {
        localStorage.setItem(FORM_SCHEMA_STORAGE_PREFIX + surveyId, JSON.stringify(clean));
    } catch (e) { /* ignore */ }

    if (typeof surveys !== 'undefined' && Array.isArray(surveys)) {
        const survey = surveys.find((entry) => entry.id === surveyId);
        if (survey) survey.formSchema = clean;
    }

    try {
        await db.collection('surveys').doc(surveyId).set({ formSchema: clean }, { merge: true });
    } catch (error) {
        console.warn('회차 formSchema 서버 저장 실패, 로컬만 유지:', error);
        if (typeof rewriteUserMaster === 'function') {
            try {
                await rewriteUserMaster('surveys', (list) => list.map((entry) => (
                    entry.id === surveyId ? { ...entry, formSchema: clean } : entry
                )));
            } catch (e2) {
                console.warn('users 마스터 formSchema 저장 실패:', e2);
            }
        }
    }
    return clean;
}

function getActiveSchemaFields(options = {}) {
    const schema = options.schema || activeFormSchema || getSurveyFormSchema();
    if (!schema?.fields?.length) return null;
    const fields = schema.fields.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    if (options.formOnly) return fields.filter((f) => f.showInForm !== false);
    if (options.compareOnly) return fields.filter((f) => f.compare);
    return fields;
}

function ensureSchemaExtraFields(fields) {
    const host = document.getElementById('schemaExtraFields');
    if (!host) return;
    const customs = (fields || []).filter((f) => f.custom && f.showInForm !== false);
    if (!customs.length) {
        host.innerHTML = '';
        host.hidden = true;
        return;
    }
    host.hidden = false;
    host.innerHTML = customs.map((field) => `
        <div class="form-group" data-field="${escapeHtml(field.key)}" data-schema-custom="1">
            <label for="${escapeHtml(field.key)}">${escapeHtml(field.label)}</label>
            <input type="text" id="${escapeHtml(field.key)}" name="${escapeHtml(field.key)}"
                   placeholder="${escapeHtml(field.excelHeader || field.label)}" enterkeyhint="next" autocomplete="off">
        </div>
    `).join('');
}

function updateSchemaFieldLabels(fields) {
    const byKey = {};
    (fields || []).forEach((field) => { byKey[field.key] = field; });

    const setLabel = (fieldKey, text) => {
        const group = document.querySelector(`#itemForm [data-field="${fieldKey}"]`);
        if (!group) return;
        const label = group.querySelector(`label[for="${fieldKey}"], .form-section-title, label`);
        if (!label) return;
        if (fieldKey === 'location' || fieldKey === 'usefulLife' || fieldKey === 'dimensions') {
            if (label.classList.contains('form-section-title') || !label.getAttribute('for')) {
                label.textContent = text.startsWith('📍') || text.startsWith('📏') ? text : text;
            } else {
                label.textContent = text;
            }
        } else {
            const required = byKey[fieldKey]?.required ? ' *' : '';
            label.textContent = `${text}${required}`;
        }
    };

    Object.keys(byKey).forEach((key) => {
        if (byKey[key].custom) return;
        if (key === 'location') {
            setLabel('location', byKey[key].label || '사용위치');
            return;
        }
        if (key === 'usefulLife') {
            setLabel('usefulLife', byKey[key].label || '내용연수 분류');
            return;
        }
        setLabel(key, byKey[key].label || byKey[key].systemLabel || key);
    });
}

function applyFormSchema(schema, options = {}) {
    const nextSchema = schema && schema.fields?.length ? schema : null;
    const signature = formSchemaSignature(nextSchema);
    const schemaChanged = options.force || signature !== activeFormSchemaSignature;

    activeFormSchema = nextSchema;
    activeFormSchemaSignature = signature;
    window.activeFormSchema = activeFormSchema;

    const banner = document.getElementById('formSchemaBanner');
    const formFields = getActiveSchemaFields({ schema: activeFormSchema, formOnly: true });

    if (!activeFormSchema || !formFields) {
        if (banner) {
            banner.hidden = true;
            banner.textContent = '';
        }
        ensureSchemaExtraFields([]);
        FORM_BUILTIN_DATA_FIELDS.forEach((key) => {
            const el = document.querySelector(`#itemForm [data-field="${key}"]`);
            if (el) el.classList.remove('schema-hidden');
        });
        if (schemaChanged && typeof rebuildFieldConfigOptions === 'function') {
            rebuildFieldConfigOptions(null);
        }
        if (typeof applyFieldVisibility === 'function') applyFieldVisibility();
        return;
    }

    if (banner) {
        const count = formFields.filter((f) => f.key !== 'surveyor').length;
        banner.hidden = false;
        banner.textContent = `이 회차 입력 항목은 업로드한 엑셀 매핑 기준 ${count}개입니다.`;
    }

    ensureSchemaExtraFields(formFields);
    updateSchemaFieldLabels(formFields);

    const visible = new Set(formFields.map((f) => f.key));
    if (visible.has('building') || visible.has('floor') || visible.has('room')) {
        visible.add('location');
    }
    if (visible.has('goodsClNo') || visible.has('goodsClNm')) {
        visible.add('usefulLife');
    }

    FORM_BUILTIN_DATA_FIELDS.forEach((key) => {
        const el = document.querySelector(`#itemForm [data-field="${key}"]`);
        if (!el) return;
        el.classList.toggle('schema-hidden', !visible.has(key));
    });

    // 스키마가 바뀐 때만 연속입력 기본 항목을 다시 맞춘다
    if (schemaChanged && typeof selectedFields !== 'undefined') {
        const schemaKeys = formFields
            .filter((f) => f.showInForm !== false && f.type !== 'hidden')
            .map((f) => f.key);
        const preferred = schemaKeys.filter((key) => (
            formFields.find((f) => f.key === key)?.core
            || !formFields.find((f) => f.key === key)?.optionalGroup
        ));
        const next = Array.from(new Set(['surveyor', 'itemName', ...preferred]));
        try {
            const saved = JSON.parse(localStorage.getItem('fieldModeFields') || 'null');
            if (Array.isArray(saved) && saved.length) {
                const overlap = saved.filter((key) => schemaKeys.includes(key) || key === 'surveyor' || key === 'itemName');
                selectedFields = overlap.length >= 2 ? Array.from(new Set(['surveyor', 'itemName', ...overlap])) : next;
            } else {
                selectedFields = next;
            }
        } catch (e) {
            selectedFields = next;
        }
    }

    if (schemaChanged && typeof rebuildFieldConfigOptions === 'function') {
        rebuildFieldConfigOptions(formFields);
    }
    if (typeof applyFieldVisibility === 'function') {
        applyFieldVisibility();
    }
}

function applyFormSchemaForCurrentSurvey() {
    const writable = typeof getWritableSurvey === 'function' ? getWritableSurvey() : null;
    const sid = writable && !writable.isFallback ? writable.id : (
        typeof currentSurveyId !== 'undefined'
        && currentSurveyId
        && currentSurveyId !== '__all__'
        && currentSurveyId !== '__unassigned__'
            ? currentSurveyId
            : ''
    );
    applyFormSchema(sid ? getSurveyFormSchema(sid) : null);
}

function getBaselineCompareFieldsFromSchema() {
    const fields = getActiveSchemaFields({ compareOnly: true });
    if (!fields?.length) return null;
    return fields
        .filter((f) => f.key !== 'surveyor' && f.key !== 'assetNumber' && f.key !== 'notes')
        .map((f) => ({
            key: f.key,
            label: f.label || f.systemLabel || f.key,
            formId: f.key,
            custom: !!f.custom
        }));
}

function flattenMappedExtras(row, schema) {
    if (!row || typeof row !== 'object') return row;
    const next = { ...row };
    const extra = row.extra && typeof row.extra === 'object' ? row.extra : null;
    const schemaFields = schema?.fields || getActiveSchemaFields() || [];
    schemaFields.filter((f) => f.custom && f.excelHeader).forEach((field) => {
        if (extra && extra[field.excelHeader] != null && String(extra[field.excelHeader]).trim() !== '') {
            next[field.key] = String(extra[field.excelHeader]).trim();
        }
    });
    return next;
}

function initFormSchema() {
    applyFormSchemaForCurrentSurvey();
    document.getElementById('surveySelect')?.addEventListener('change', () => {
        setTimeout(applyFormSchemaForCurrentSurvey, 0);
    });
}

window.buildFormSchemaFromMapping = buildFormSchemaFromMapping;
window.saveFormSchemaToSurvey = saveFormSchemaToSurvey;
window.getSurveyFormSchema = getSurveyFormSchema;
window.applyFormSchema = applyFormSchema;
window.applyFormSchemaForCurrentSurvey = applyFormSchemaForCurrentSurvey;
window.renderRegisterFormSchemaSection = renderRegisterFormSchemaSection;
window.syncPendingFormFieldSelections = syncPendingFormFieldSelections;
window.getBaselineCompareFieldsFromSchema = getBaselineCompareFieldsFromSchema;
window.getActiveSchemaFields = getActiveSchemaFields;
window.customFieldKeyFromHeader = customFieldKeyFromHeader;
window.flattenMappedExtras = flattenMappedExtras;
window.initFormSchema = initFormSchema;
window.activeFormSchemaRef = () => activeFormSchema;

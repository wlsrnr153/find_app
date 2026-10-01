// 학습 사전(물품명 → 분류번호)의 병합·저장·삭제를 Firestore 대역으로 검증한다
//   node scripts/test-useful-life-dict.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const publicDir = path.join(__dirname, '..', 'public');
const snapshot = JSON.parse(fs.readFileSync(path.join(publicDir, 'useful-life.json'), 'utf8'));

// --- Firestore 대역 --------------------------------------------------------
const store = new Map();
function docRef(id) {
    return {
        id,
        get: async () => ({ id, data: () => store.get(id) || null }),
        set: async (patch, options) => {
            const base = options && options.merge ? (store.get(id) || {}) : {};
            store.set(id, { ...base, ...patch });
        }
    };
}
// 컬렉션 조회가 주는 건 QueryDocumentSnapshot이라 data()와 ref를 갖는다
function docSnapshot(id) {
    return { id, data: () => store.get(id) || null, ref: docRef(id) };
}
const db = {
    collection: (name) => {
        if (name !== 'users') throw new Error('예상치 못한 컬렉션: ' + name);
        return {
            doc: docRef,
            get: async () => ({ docs: [...store.keys()].map(docSnapshot) })
        };
    }
};

const memory = new Map();
const sandbox = {
    console, db, indexedDB: null,
    fetch: () => Promise.reject(new Error('네트워크 없음')),
    currentUser: { uid: 'userA', email: 'a@example.com' },
    localStorage: {
        getItem: (k) => (memory.has(k) ? memory.get(k) : null),
        setItem: (k, v) => memory.set(k, String(v)),
        removeItem: (k) => memory.delete(k)
    },
    document: { getElementById: () => null, querySelectorAll: () => [], addEventListener: () => {} },
    window: {},
    navigator: { onLine: true },
    setTimeout,
    clearTimeout
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(publicDir, 'useful-life.js'), 'utf8'), sandbox, { filename: 'useful-life.js' });
vm.runInContext(fs.readFileSync(path.join(publicDir, 'masters.js'), 'utf8'), sandbox, { filename: 'masters.js' });
sandbox.applyUsefulLifeSnapshot(snapshot);

const {
    matchUsefulLife, getUsefulLifeAliases, setUsefulLifeAliases,
    restoreUsefulLifeAliases, loadUsefulLifeAliases,
    saveUsefulLifeAlias, removeUsefulLifeAlias
} = sandbox;

let failed = 0;
function check(label, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) failed += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  → ${JSON.stringify(actual)} (기대 ${JSON.stringify(expected)})`}`);
}

function aliasCountInDoc(uid) {
    return (store.get(uid)?.usefulLifeAliases || []).length;
}

// 분류번호를 손으로 적으면 틀리기 쉬워서 스냅샷에서 찾아 쓴다
function codeOf(goodsClNm) {
    const row = snapshot['표'].find((entry) => entry[1] === goodsClNm);
    if (!row) throw new Error('표에 없는 품명: ' + goodsClNm);
    return { goodsClNo: row[0], goodsClNm: row[1], usefulLife: row[2] };
}

(async () => {
    console.log('\n[한 사람이 고르면 팀 전체가 쓴다]');
    store.set('userB', {
        usefulLifeAliases: [{ nameKey: '에어컨', ...codeOf('냉방기'), decidedAt: '2026-01-01T00:00:00.000Z' }]
    });
    await loadUsefulLifeAliases();
    check('다른 사람이 고른 것도 반영', matchUsefulLife('에어컨').entry.goodsClNm, '냉방기');
    check('판정은 확정', matchUsefulLife('에어컨').verdict, 'resolved');
    check('경로는 alias', matchUsefulLife('에어컨').entry.match, 'alias');
    check('연수', matchUsefulLife('에어컨').entry.usefulLife, codeOf('냉방기').usefulLife);

    console.log('\n[같은 이름을 다르게 골랐으면 최근 결정이 이긴다]');
    store.set('userC', {
        usefulLifeAliases: [{ nameKey: '에어컨', ...codeOf('공기조화기'), decidedAt: '2026-06-01T00:00:00.000Z' }]
    });
    await loadUsefulLifeAliases();
    check('최근 것이 이김', matchUsefulLife('에어컨').entry.goodsClNm, '공기조화기');
    check('사전 항목 수', getUsefulLifeAliases().length, 1);

    console.log('\n[내가 고르면 내 문서에만 저장된다]');
    await saveUsefulLifeAlias({ nameKey: '냉장고', ...codeOf('대형냉장고') });
    check('내 문서에 1건', aliasCountInDoc('userA'), 1);
    check('남의 문서는 그대로', aliasCountInDoc('userB'), 1);
    check('저장 즉시 매칭에 반영', matchUsefulLife('냉장고').entry.goodsClNm, '대형냉장고');
    check('확인필요였던 것이 확정으로', matchUsefulLife('냉장고').verdict, 'resolved');

    console.log('\n[같은 이름을 다시 고르면 쌓이지 않고 갈아끼운다]');
    await saveUsefulLifeAlias({ nameKey: '냉장고', ...codeOf('김치냉장고') });
    check('여전히 1건', aliasCountInDoc('userA'), 1);
    check('새로 고른 것이 적용', matchUsefulLife('냉장고').entry.goodsClNm, '김치냉장고');
    check('연수도 바뀜', matchUsefulLife('냉장고').entry.usefulLife, codeOf('김치냉장고').usefulLife);

    console.log('\n[정규화해서 저장하므로 표기가 달라도 맞는다]');
    await saveUsefulLifeAlias({ nameKey: ' 프로젝터 ', ...codeOf('비디오프로젝터') });
    check('공백 포함 입력', matchUsefulLife('프로젝터').entry.goodsClNm, '비디오프로젝터');
    check('조회도 공백 무시', matchUsefulLife(' 프로 젝터 ').entry.goodsClNm, '비디오프로젝터');

    console.log('\n[오프라인에서도 사전이 살아 있다]');
    const cached = JSON.parse(memory.get('usefulLifeAliases') || '[]');
    check('로컬에 캐시됨', cached.length, getUsefulLifeAliases().length);
    setUsefulLifeAliases([]);
    check('메모리 비움', matchUsefulLife('냉장고').verdict, 'ambiguous');
    check('로컬에서 복원', restoreUsefulLifeAliases(), cached.length);
    check('복원 후 매칭', matchUsefulLife('냉장고').entry.goodsClNm, '김치냉장고');

    console.log('\n[Firestore를 못 읽으면 로컬 사본으로 버틴다]');
    const realCollection = db.collection;
    db.collection = () => { throw new Error('permission-denied'); };
    setUsefulLifeAliases([]);
    const restored = await loadUsefulLifeAliases();
    db.collection = realCollection;
    check('로컬 사본으로 복구', restored, cached.length);
    check('매칭 계속 동작', matchUsefulLife('냉장고').entry.goodsClNm, '김치냉장고');

    console.log('\n[내 것은 지울 수 있고 남의 것은 덮어써야 한다]');
    await removeUsefulLifeAlias('냉장고');
    check('내 문서에서 빠짐', (store.get('userA').usefulLifeAliases || []).some((r) => r.nameKey === '냉장고'), false);
    check('매칭도 원래대로', matchUsefulLife('냉장고').verdict, 'ambiguous');
    await removeUsefulLifeAlias('에어컨');
    await loadUsefulLifeAliases();
    check('남이 고른 것은 다시 살아남', matchUsefulLife('에어컨').entry.goodsClNm, '공기조화기');

    console.log('\n[잘못된 입력]');
    check('빈 이름 거부', await saveUsefulLifeAlias({ nameKey: '', goodsClNo: '123' }).then(() => 'ok', (e) => e.message), '물품명과 분류번호가 필요합니다');
    check('빈 분류번호 거부', await saveUsefulLifeAlias({ nameKey: '무언가', goodsClNo: '' }).then(() => 'ok', (e) => e.message), '물품명과 분류번호가 필요합니다');

    console.log(`\n실패 ${failed}건 / 전체 검사 통과 여부: ${failed === 0 ? 'OK' : 'NG'}`);
    process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
    console.error('예외:', err);
    process.exit(1);
});

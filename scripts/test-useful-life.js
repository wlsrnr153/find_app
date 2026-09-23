// useful-life.js의 매칭 엔진을 브라우저 없이 검증한다
//   node scripts/test-useful-life.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const publicDir = path.join(__dirname, '..', 'public');
const source = fs.readFileSync(path.join(publicDir, 'useful-life.js'), 'utf8');
const snapshot = JSON.parse(fs.readFileSync(path.join(publicDir, 'useful-life.json'), 'utf8'));

const sandbox = { console, indexedDB: null, fetch: () => Promise.reject(new Error('네트워크 없음')) };
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'useful-life.js' });
sandbox.applyUsefulLifeSnapshot(snapshot);

const { matchUsefulLife, setUsefulLifeAliases, getUsefulLifeMeta } = sandbox;

let failed = 0;
function check(label, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) failed += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  → ${JSON.stringify(actual)} (기대 ${JSON.stringify(expected)})`}`);
}

function summary(name, extra) {
    const r = matchUsefulLife(extra ? { itemName: name, ...extra } : name);
    return {
        verdict: r.verdict,
        years: r.entry ? r.entry.usefulLife : null,
        match: r.entry ? r.entry.match : null,
        auto: r.auto,
        candidates: r.candidates.length
    };
}

console.log('\n[스냅샷]');
check('건수', getUsefulLifeMeta().건수, 11591);

console.log('\n[정확 일치는 바로 확정된다]');
check('노트북컴퓨터', summary('노트북컴퓨터'), { verdict: 'resolved', years: 6, match: 'exact', auto: true, candidates: 0 });
check('원심분리기', summary('원심분리기'), { verdict: 'resolved', years: 11, match: 'exact', auto: true, candidates: 0 });
check('항온수조', summary('항온수조'), { verdict: 'resolved', years: 12, match: 'exact', auto: true, candidates: 0 });
check('승용자동차', summary('승용자동차'), { verdict: 'resolved', years: 8, match: 'exact', auto: true, candidates: 0 });
check('공백·하이픈 무시', summary(' 노트북 - 컴퓨터 '), { verdict: 'resolved', years: 6, match: 'exact', auto: true, candidates: 0 });

console.log('\n[분류번호가 있으면 이름을 보지 않는다]');
check('25101503', summary('아무거나', { goodsClNo: '25101503' }), { verdict: 'resolved', years: 8, match: 'code', auto: true, candidates: 0 });
check('없는 분류번호는 이름으로 넘어감', summary('항온수조', { goodsClNo: '00000000' }), { verdict: 'resolved', years: 12, match: 'exact', auto: true, candidates: 0 });

console.log('\n[모델명이 붙어도 품명을 뽑아낸다]');
check('실체현미경 SZ61', summary('실체현미경 SZ61'), { verdict: 'resolved', years: 13, match: 'contains', auto: true, candidates: 1 });
check('삼성 노트북컴퓨터 NT550', summary('삼성 노트북컴퓨터 NT550').verdict, 'resolved');
check('삼성 노트북컴퓨터 NT550 연수', summary('삼성 노트북컴퓨터 NT550').years, 6);

console.log('\n[미고시와 못찾음은 구분된다]');
check('전자식저울', summary('전자식저울'), { verdict: 'unnotified', years: 0, match: 'exact', auto: true, candidates: 0 });
check('존재하지않는물품', summary('zzz존재하지않는물품zzz').verdict, 'missing');

console.log('\n[연수가 갈리면 사람이 고른다]');
const fridge = matchUsefulLife('냉장고');
check('냉장고 판정', fridge.verdict, 'ambiguous');
check('냉장고 자동확정 안 함', fridge.auto, false);
check('냉장고 후보에 대형냉장고', fridge.candidates.some((c) => c.goodsClNm === '대형냉장고'), true);
check('냉장고 후보에 김치냉장고', fridge.candidates.some((c) => c.goodsClNm === '김치냉장고'), true);
check('냉장고 후보 연수가 갈림', new Set(fridge.candidates.filter((c) => c.notified).map((c) => c.usefulLife)).size > 1, true);

const aircon = matchUsefulLife('에어컨');
check('에어컨 판정', aircon.verdict, 'ambiguous');
check('에어컨 자동확정 안 함', aircon.auto, false);

console.log('\n[짧은 품명이 긴 이름에 끼어들어 오탐을 내면 안 된다]');
check('회의자료 ⊅ 의자', matchUsefulLife('회의자료').auto, false);
check('에어컨 ⊅ 에어컨베이어', aircon.entry, null);
// 글자쌍이 하나만 겹치는 건 우연이다. 무전기 → 전기로/반전기 같은 후보를 내면 안 된다
check('무전기는 못찾음', matchUsefulLife('무전기').verdict, 'missing');
const scale = matchUsefulLife('전자저울');
check('전자저울 후보는 전자식저울뿐', scale.candidates.map((c) => c.goodsClNm), ['전자식저울']);

console.log('\n[합성 물품명 – 품명을 통째로 품으면 확정, 아니면 사람에게 넘긴다]');
[
    ['전동드릴세트', true],
    ['사무용의자', false],
    ['회의용책상', false],
    ['이동식칠판', false],
    ['실험대 1800x750', false]
].forEach(([name, shouldAuto]) => {
    const r = matchUsefulLife(name);
    const label = `${name} → ${r.entry ? r.entry.goodsClNm + ' ' + r.entry.usefulLife + '년' : r.verdict}`;
    check(label, r.auto && !!r.entry && r.entry.match === 'contains', shouldAuto);
});

console.log('\n[학습 사전이 후보 고르기를 대신한다]');
check('사전 등록 전', summary('에어컨').verdict, 'ambiguous');
setUsefulLifeAliases([{ nameKey: '에어컨', goodsClNo: '40101701' }]);
check('사전 등록 후', summary('에어컨'), { verdict: 'resolved', years: 10, match: 'alias', auto: true, candidates: 0 });
check('사전은 정규화해서 맞춘다', summary(' 에어컨 ').match, 'alias');
setUsefulLifeAliases([]);
check('사전 비우면 원래대로', summary('에어컨').verdict, 'ambiguous');

console.log('\n[빈 입력]');
check('빈 문자열', summary(''), { verdict: 'missing', years: null, match: null, auto: false, candidates: 0 });
check('null', summary(null), { verdict: 'missing', years: null, match: null, auto: false, candidates: 0 });

console.log('\n[실제 대장 물품명 표본]');
const samples = ['노트북컴퓨터', '데스크탑컴퓨터', '원심분리기', '항온수조', '책상', '의자', '냉장고', '에어컨',
    '전자저울', '프로젝터', '실체현미경 SZ61', '승용자동차', '복사기', '파쇄기', '서버', '무전기'];
const tally = { resolved: 0, unnotified: 0, ambiguous: 0, missing: 0 };
samples.forEach((name) => {
    const r = matchUsefulLife(name);
    tally[r.verdict] += 1;
    const detail = r.entry
        ? `${r.entry.goodsClNm} ${r.entry.notified ? r.entry.usefulLife + '년' : '미고시'} (${r.entry.match})`
        : r.candidates.slice(0, 3).map((c) => `${c.goodsClNm}=${c.notified ? c.usefulLife : '미고시'}`).join(', ') || '-';
    console.log(`  ${name.padEnd(16)} ${r.verdict.padEnd(11)} ${detail}`);
});
console.log(`  합계 ${JSON.stringify(tally)}`);

console.log('\n[속도]');
const t = Date.now();
const unique = new Set();
snapshot.표.forEach((row, i) => { if (i % 7 === 0) unique.add(row[1] + ' X100'); });
const names = [...unique];
names.forEach((n) => matchUsefulLife(n));
const elapsed = Date.now() - t;
console.log(`  고유 물품명 ${names.length}개 매칭 ${elapsed}ms`);
// 업로드 때 화면이 멈추면 안 된다. 표를 매번 훑던 초기 구현은 여기서 10초가 걸렸다
check(`${names.length}개를 1초 안에`, elapsed < 1000, true);

console.log(`\n실패 ${failed}건 / 전체 검사 통과 여부: ${failed === 0 ? 'OK' : 'NG'}`);
process.exit(failed === 0 ? 0 : 1);

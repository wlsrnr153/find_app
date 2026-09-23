// register.js의 취득일자·물품분류번호 파서를 브라우저 없이 검증한다
//   node scripts/test-register-fields.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'register.js'), 'utf8');
const sandbox = {
    console,
    document: { getElementById: () => null, querySelectorAll: () => [], addEventListener: () => {} },
    window: {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    navigator: { onLine: true },
    indexedDB: null,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    IntersectionObserver: function () { this.observe = () => {}; this.disconnect = () => {}; }
};
vm.createContext(sandbox);
// 최상위 const는 전역 객체의 속성이 되지 않으므로 따로 꺼낸다
vm.runInContext(`${source}\n;globalThis.__exports = { REGISTER_SYSTEM_FIELDS, REGISTER_LEAN_KEYS };`,
    sandbox, { filename: 'register.js' });

let failed = 0;
function check(label, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) failed += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  → ${JSON.stringify(actual)} (기대 ${JSON.stringify(expected)})`}`);
}

const { parseAcquiredDate, normalizeGoodsClNo } = sandbox;
const { REGISTER_SYSTEM_FIELDS, REGISTER_LEAN_KEYS } = sandbox.__exports;

console.log('\n[취득일자 파서]');
[
    ['2018-03-15', '2018-03-15'],
    ['2018.03.15', '2018-03-15'],
    ['2018. 3. 15', '2018-03-15'],
    ['2018/3/5', '2018-03-05'],
    ['2018년 3월 15일', '2018-03-15'],
    ['2018년 3월', '2018-03-01'],
    ['20180315', '2018-03-15'],
    ['201803', '2018-03-01'],
    ['2018-03', '2018-03-01'],
    ['2018', '2018-01-01'],
    ['43174', '2018-03-15'],
    ['  2018-03-15  ', '2018-03-15'],
    ['2024-02-29', '2024-02-29']
].forEach(([input, expected]) => check(`"${input}"`, parseAcquiredDate(input), expected));

console.log('\n[취득일자 – 값이 없거나 이상한 경우]');
[
    ['', ''],
    [null, ''],
    [undefined, ''],
    ['-', ''],
    ['미상', ''],
    ['N/A', ''],
    ['1899-01-01', ''],
    ['2200-01-01', '']
].forEach(([input, expected]) => check(`${JSON.stringify(input)}`, parseAcquiredDate(input), expected));

console.log('\n[취득일자 – 범위를 벗어나면 날짜를 지어내지 않는다]');
check('2018-02-30 (2월 30일)', parseAcquiredDate('2018-02-30'), '');
check('2018-13-05 (13월)', parseAcquiredDate('2018-13-05'), '');
check('2018-00-05 (0월)', parseAcquiredDate('2018-00-05'), '');
// 다른 realm의 Date도 인식해야 한다 (instanceof를 쓰면 여기서 깨진다)
check('Date 객체', parseAcquiredDate(new Date(2018, 2, 15)), '2018-03-15');
check('잘못된 Date 객체', parseAcquiredDate(new Date('없음')), '');

console.log('\n[물품분류번호]');
[
    ['41103706', '41103706'],
    ['4110370601', '41103706'],
    ['41-10-3706', '41103706'],
    ['41 10 3706', '41103706'],
    ['1234567', ''],
    ['', ''],
    [null, ''],
    ['분류없음', '']
].forEach(([input, expected]) => check(`${JSON.stringify(input)}`, normalizeGoodsClNo(input), expected));

console.log('\n[스키마]');
const keys = REGISTER_SYSTEM_FIELDS.map((f) => f.key);
check('goodsClNo 추가됨', keys.includes('goodsClNo'), true);
check('acquiredAt 추가됨', keys.includes('acquiredAt'), true);
check('goodsClNo가 category보다 앞', keys.indexOf('goodsClNo') < keys.indexOf('category'), true);
check('acquiredAt이 quantity보다 뒤', keys.indexOf('acquiredAt') > keys.indexOf('quantity'), true);
check('새 필드가 저장 대상', ['goodsClNo', 'acquiredAt'].every((k) => REGISTER_LEAN_KEYS.includes(k)), true);
check('필수 필드는 그대로', REGISTER_SYSTEM_FIELDS.filter((f) => f.required).map((f) => f.key), ['assetNumber', 'itemName']);

console.log('\n[헤더 자동 매핑]');
const { suggestRegisterMapping, applyRegisterMapping } = sandbox;
const headers = ['순번', '자산번호', '자산명', '물품분류번호', '계정과목명', '취득수량', '취득일자', '규격', '현 사용위치'];
const sampleRows = [{
    순번: '1', 자산번호: 'A-001', 자산명: '노트북컴퓨터', 물품분류번호: '4321150301',
    계정과목명: '기계기구', 취득수량: '1', 취득일자: '2018. 3. 15', 규격: 'NT550', '현 사용위치': '본관 3층'
}];
const mapping = suggestRegisterMapping(headers, null, sampleRows);
check('취득일자 → acquiredAt', mapping.acquiredAt, '취득일자');
check('취득수량 → quantity', mapping.quantity, '취득수량');
check('물품분류번호 → goodsClNo', mapping.goodsClNo, '물품분류번호');
check('계정과목명 → category', mapping.category, '계정과목명');

const mapped = applyRegisterMapping(sampleRows, mapping)[0];
check('취득일자 정규화', mapped.acquiredAt, '2018-03-15');
check('세부품명번호 앞 8자리', mapped.goodsClNo, '43211503');
check('카테고리 유지', mapped.category, '기계기구');

console.log('\n[분류번호 열만 있는 대장 – 기존 분류 표시가 비지 않아야 한다]');
const onlyClNo = ['자산번호', '물품명', '분류번호'];
const onlyRows = [{ 자산번호: 'A-002', 물품명: '항온수조', 분류번호: '41103706' }];
const m2 = suggestRegisterMapping(onlyClNo, null, onlyRows);
check('분류번호 → goodsClNo', m2.goodsClNo, '분류번호');
const mapped2 = applyRegisterMapping(onlyRows, m2)[0];
check('goodsClNo 채워짐', mapped2.goodsClNo, '41103706');
check('category 폴백', mapped2.category, '41103706');

console.log(`\n실패 ${failed}건 / 전체 검사 통과 여부: ${failed === 0 ? 'OK' : 'NG'}`);
process.exit(failed === 0 ? 0 : 1);

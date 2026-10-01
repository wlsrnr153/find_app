// 취득일자 + 내용연수 → 만료일, 경과·임박·정상·미산정 판정을 검증한다
//   node scripts/test-useful-life-elapsed.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const publicDir = path.join(__dirname, '..', 'public');
const snapshot = JSON.parse(fs.readFileSync(path.join(publicDir, 'useful-life.json'), 'utf8'));

const sandbox = { console, indexedDB: null, fetch: () => Promise.reject(new Error('네트워크 없음')), localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(publicDir, 'useful-life.js'), 'utf8'), sandbox, { filename: 'useful-life.js' });
sandbox.applyUsefulLifeSnapshot(snapshot);

const { addYearsToDateKey, durationLabel, usefulLifeStatus, describeUsefulLife, daysBetweenDateKeys } = sandbox;

let failed = 0;
function check(label, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) failed += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  → ${JSON.stringify(actual)} (기대 ${JSON.stringify(expected)})`}`);
}

const TODAY = '2026-09-23';

console.log('\n[만료일 계산]');
check('2018-03-15 + 10년', addYearsToDateKey('2018-03-15', 10), '2028-03-15');
check('2020-02-29 + 4년 (윤년끼리)', addYearsToDateKey('2020-02-29', 4), '2024-02-29');
check('2020-02-29 + 1년 (없는 날 → 말일)', addYearsToDateKey('2020-02-29', 1), '2021-02-28');
check('2020-01-31 + 6년', addYearsToDateKey('2020-01-31', 6), '2026-01-31');
check('빈 값', addYearsToDateKey('', 10), '');
check('형식 오류', addYearsToDateKey('2018/03/15', 10), '');

console.log('\n[기간 표기]');
check('1년 2개월', durationLabel('2026-01-23', '2027-03-23'), '1년 2개월');
check('딱 2년', durationLabel('2024-09-23', '2026-09-23'), '2년');
check('5개월', durationLabel('2026-04-23', '2026-09-23'), '5개월');
check('하루 모자란 한 달', durationLabel('2026-08-24', '2026-09-23'), '30일');
check('같은 날', durationLabel('2026-09-23', '2026-09-23'), '0일');

console.log('\n[경과 / 임박 / 정상 경계값]');
// 취득 2016-09-23 + 10년 = 2026-09-23 = 오늘
check('오늘이 만료일', usefulLifeStatus('2016-09-23', 10, TODAY).status, 'expired');
check('오늘이 만료일 문구', usefulLifeStatus('2016-09-23', 10, TODAY).label, '오늘 만료');
check('하루 지남', usefulLifeStatus('2016-09-22', 10, TODAY).status, 'expired');
check('하루 지남 문구', usefulLifeStatus('2016-09-22', 10, TODAY).label, '1일 경과');
check('하루 남음', usefulLifeStatus('2016-09-24', 10, TODAY).status, 'due');
// 임박 경계는 365일
check('365일 남음은 임박', usefulLifeStatus('2017-09-23', 10, TODAY).days, 365);
check('365일 남음 판정', usefulLifeStatus('2017-09-23', 10, TODAY).status, 'due');
check('366일 남음은 정상', usefulLifeStatus('2017-09-24', 10, TODAY).days, 366);
check('366일 남음 판정', usefulLifeStatus('2017-09-24', 10, TODAY).status, 'ok');

console.log('\n[경과 기간 표기]');
check('3년 넘게 경과', usefulLifeStatus('2013-06-15', 10, TODAY).label, '3년 3개월 경과');
check('만료일', usefulLifeStatus('2013-06-15', 10, TODAY).expiry, '2023-06-15');
check('남은 기간', usefulLifeStatus('2022-01-10', 10, TODAY).label, '5년 3개월 남음');

console.log('\n[미산정]');
check('취득일자 없음', usefulLifeStatus('', 10, TODAY), { status: 'unknown', reason: 'no-date', expiry: '', days: null, label: '취득일자 없음' });
check('연수 없음', usefulLifeStatus('2018-03-15', 0, TODAY), { status: 'unknown', reason: 'no-life', expiry: '', days: null, label: '내용연수 없음' });
check('연수가 문자열 미고시', usefulLifeStatus('2018-03-15', '미고시', TODAY).reason, 'no-life');
check('취득일자 형식 오류', usefulLifeStatus('2018년 3월', 10, TODAY).reason, 'bad-date');

console.log('\n[매칭과 합친 결과]');
const laptop = describeUsefulLife({ itemName: '노트북컴퓨터', acquiredAt: '2018-03-15' }, TODAY);
check('노트북 판정', laptop.verdict, 'resolved');
check('노트북 연수', laptop.usefulLife, 6);
check('노트북 만료일', laptop.expiry, '2024-03-15');
check('노트북 경과', laptop.status, 'expired');
check('노트북 문구', laptop.label, '2년 6개월 경과');
check('노트북 비고 없음', laptop.note, '');

const scale = describeUsefulLife({ itemName: '전자식저울', acquiredAt: '2018-03-15' }, TODAY);
check('미고시 판정', scale.verdict, 'unnotified');
check('미고시는 미산정', scale.status, 'unknown');
check('미고시 비고', scale.note, '고시된 내용연수가 없습니다');

const fridge = describeUsefulLife({ itemName: '냉장고', acquiredAt: '2018-03-15' }, TODAY);
check('확인필요 판정', fridge.verdict, 'ambiguous');
check('확인필요 비고', fridge.note, '물품명 확인이 필요합니다');
check('확인필요 후보 있음', fridge.candidates.length > 0, true);

const unknown = describeUsefulLife({ itemName: 'zzz없는물품zzz', acquiredAt: '2018-03-15' }, TODAY);
check('못찾음 비고', unknown.note, '내용연수 표에서 찾지 못했습니다');

const noDate = describeUsefulLife({ itemName: '노트북컴퓨터' }, TODAY);
check('취득일자 없으면 미산정', noDate.status, 'unknown');
check('연수는 알고 있음', noDate.usefulLife, 6);
check('취득일자 비고', noDate.note, '취득일자가 없습니다');

const byCode = describeUsefulLife({ itemName: '아무거나', goodsClNo: '25101503', acquiredAt: '2020-01-01' }, TODAY);
check('분류번호 우선', byCode.goodsClNm, '승용자동차');
check('분류번호 만료일', byCode.expiry, '2028-01-01');
check('분류번호 정상', byCode.status, 'ok');

console.log('\n[날짜 차이]');
check('연도 넘김', daysBetweenDateKeys('2025-12-31', '2026-01-01'), 1);
check('윤년 포함 1년', daysBetweenDateKeys('2024-01-01', '2025-01-01'), 366);
check('역방향은 음수', daysBetweenDateKeys('2026-09-23', '2026-09-20'), -3);

console.log(`\n실패 ${failed}건 / 전체 검사 통과 여부: ${failed === 0 ? 'OK' : 'NG'}`);
process.exit(failed === 0 ? 0 : 1);

// 대조 화면을 만들기 전에 결과를 눈으로 확인하려고, 가짜 대장으로 내보내기를 그대로 돌려
// 표본 엑셀을 만든다. 동시에 시트 구성과 집계가 맞는지 검사한다.
//   node scripts/sample-useful-life-export.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const XLSXreal = require('xlsx');

const publicDir = path.join(__dirname, '..', 'public');
const snapshot = JSON.parse(fs.readFileSync(path.join(publicDir, 'useful-life.json'), 'utf8'));

// 실제 재물조사 대장에서 흔히 보이는 모양으로 만든다
const SURVEY_ID = 'sv_sample';
const registerRows = [
    { assetNumber: 'A-0001', itemName: '노트북컴퓨터', acquiredAt: '2018-03-15', location: '본관 3층 301호', quantity: '1' },
    { assetNumber: 'A-0002', itemName: '노트북컴퓨터', acquiredAt: '2024-06-01', location: '본관 3층 301호', quantity: '1' },
    { assetNumber: 'A-0003', itemName: '삼성 노트북컴퓨터 NT550', acquiredAt: '2020-09-09', location: '본관 3층 302호', quantity: '1' },
    { assetNumber: 'A-0004', itemName: '원심분리기', acquiredAt: '2015-01-20', location: '연구동 2층 201호', quantity: '1' },
    { assetNumber: 'A-0005', itemName: '항온수조', acquiredAt: '2015-01-01', location: '연구동 2층 201호', quantity: '1' },
    { assetNumber: 'A-0006', itemName: '실체현미경 SZ61', acquiredAt: '2014-05-10', location: '연구동 2층 203호', quantity: '1' },
    { assetNumber: 'A-0007', itemName: '전동드릴세트', acquiredAt: '2021-04-04', location: '공작실', quantity: '1' },
    { assetNumber: 'A-0008', itemName: '전자식저울', acquiredAt: '2019-02-02', location: '연구동 1층 101호', quantity: '1' },
    { assetNumber: 'A-0009', itemName: '냉장고', acquiredAt: '2017-08-08', location: '휴게실', quantity: '1' },
    { assetNumber: 'A-0010', itemName: '냉장고', acquiredAt: '2019-12-25', location: '연구동 1층 102호', quantity: '1' },
    { assetNumber: 'A-0011', itemName: '에어컨', acquiredAt: '2016-03-03', location: '본관 2층 강의실', quantity: '2' },
    { assetNumber: 'A-0012', itemName: '무전기', acquiredAt: '2018-01-01', location: '수위실', quantity: '4' },
    { assetNumber: 'A-0013', itemName: '책상', acquiredAt: '', location: '본관 1층 사무실', quantity: '6' },
    { assetNumber: 'A-0014', itemName: '승용자동차', goodsClNo: '25101503', acquiredAt: '2019-07-07', location: '주차장', quantity: '1' },
    { assetNumber: 'A-0015', itemName: '프로젝터', acquiredAt: '2013-06-15', location: '본관 2층 강의실', status: 'missing', quantity: '1' }
].map((row, index) => ({ id: `reg_${index + 1}`, surveyId: SURVEY_ID, ...row }));

// 자산번호 일부는 이미 조사된 것으로 둬서 대조상태가 섞이게 한다
const surveyedItems = ['A-0001', 'A-0004', 'A-0009', 'A-0014']
    .map((assetNumber, index) => ({ id: `item_${index}`, assetNumber }));

let captured = null;
const XLSX = Object.assign(Object.create(XLSXreal), XLSXreal, {
    writeFile: (workbook, filename) => { captured = { workbook, filename }; }
});

const toasts = [];
const sandbox = {
    console, XLSX,
    indexedDB: null,
    fetch: () => Promise.reject(new Error('네트워크 없음')),
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    document: { getElementById: () => null, querySelectorAll: () => [], addEventListener: () => {} },
    window: {},
    navigator: { onLine: true },
    setTimeout, clearTimeout,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    IntersectionObserver: function () { this.observe = () => {}; this.disconnect = () => {}; },
    currentSurveyId: SURVEY_ID,
    currentUser: { uid: 'userA', email: 'a@example.com' },
    showToast: (message, kind) => toasts.push({ message, kind }),
    getItemsForView: () => surveyedItems,
    getCurrentSurvey: () => ({ id: SURVEY_ID, name: '2026년 표본' })
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(publicDir, 'useful-life.js'), 'utf8'), sandbox, { filename: 'useful-life.js' });
vm.runInContext(fs.readFileSync(path.join(publicDir, 'register.js'), 'utf8'), sandbox, { filename: 'register.js' });

sandbox.applyUsefulLifeSnapshot(snapshot);
sandbox.setRegisterItems(registerRows);

let failed = 0;
function check(label, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) failed += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  → ${JSON.stringify(actual)} (기대 ${JSON.stringify(expected)})`}`);
}

(async () => {
    await sandbox.exportRegisterUsefulLife();

    if (!captured) {
        console.error('실패: 엑셀이 생성되지 않았습니다.', toasts);
        process.exit(1);
    }

    const sheets = captured.workbook.SheetNames;
    const detail = XLSXreal.utils.sheet_to_json(captured.workbook.Sheets['대조결과']);
    const checkList = XLSXreal.utils.sheet_to_json(captured.workbook.Sheets['확인필요']);
    const summary = XLSXreal.utils.sheet_to_json(captured.workbook.Sheets['요약']);
    const summaryOf = (label) => (summary.find((row) => row['항목'] === label) || {})['값'];

    console.log('\n[시트 구성]');
    check('시트 3개', sheets, ['대조결과', '확인필요', '요약']);
    check('대조결과 행 수', detail.length, registerRows.length);
    check('파일명', /^내용연수대조_2026년 표본_\d{4}-\d{2}-\d{2}\.xlsx$/.test(captured.filename), true);

    console.log('\n[매칭 경로가 열에 제대로 들어갔다]');
    const byAsset = new Map(detail.map((row) => [row['자산번호'], row]));
    check('정확일치', byAsset.get('A-0001')['매칭경로'], '정확일치');
    check('품명포함', byAsset.get('A-0003')['매칭경로'], '품명포함');
    check('품명포함 결과', byAsset.get('A-0003')['고시품명'], '노트북컴퓨터');
    check('분류번호 우선', byAsset.get('A-0014')['매칭경로'], '분류번호');
    check('분류번호 결과', byAsset.get('A-0014')['고시품명'], '승용자동차');

    console.log('\n[판정과 내구연한]');
    check('경과', byAsset.get('A-0001')['내구연한'], '경과');
    check('경과 기간', /경과$/.test(byAsset.get('A-0001')['경과·남은기간']), true);
    check('정상', byAsset.get('A-0002')['내구연한'], '정상');
    check('임박', byAsset.get('A-0005')['내구연한'], '임박');
    check('미고시 판정', byAsset.get('A-0008')['매칭판정'], '미고시');
    check('미고시는 미산정', byAsset.get('A-0008')['내구연한'], '미산정');
    check('미고시 비고', byAsset.get('A-0008')['비고'], '고시된 내용연수가 없습니다');
    check('확인필요 판정', byAsset.get('A-0009')['매칭판정'], '확인필요');
    check('확인필요 후보 있음', (byAsset.get('A-0009')['후보'] || '').includes('냉장고'), true);
    check('못찾음', byAsset.get('A-0012')['매칭판정'], '못찾음');
    check('취득일자 없으면 미산정', byAsset.get('A-0013')['내구연한'], '미산정');
    check('그래도 연수는 나온다', byAsset.get('A-0013')['내용연수'], 9);
    check('취득일자 비고', byAsset.get('A-0013')['비고'], '취득일자가 없습니다');
    check('미산정이면 기간 칸은 비운다', byAsset.get('A-0013')['경과·남은기간'], '');

    console.log('\n[대조상태가 섞여 들어갔다]');
    check('조사된 것은 찾음', byAsset.get('A-0001')['대조상태'], '찾음');
    check('조사 안 된 것은 미조사', byAsset.get('A-0002')['대조상태'], '미조사');
    check('미발견 표시', byAsset.get('A-0015')['대조상태'], '미발견');

    console.log('\n[확인필요는 고유 물품명으로 묶인다]');
    const fridge = checkList.find((row) => row['물품명'] === '냉장고');
    check('냉장고가 목록에 있다', !!fridge, true);
    check('냉장고 2건이 1줄로', fridge['대장 건수'], 2);
    check('냉장고 후보 수', fridge['후보 수'] > 1, true);
    check('물품명 중복 없음', checkList.length, new Set(checkList.map((row) => row['물품명'])).size);
    check('건수 많은 순', checkList[0]['대장 건수'] >= checkList[checkList.length - 1]['대장 건수'], true);

    console.log('\n[요약 집계]');
    check('총 건수', summaryOf('대장 총 건수'), registerRows.length);
    // 15행 중 노트북컴퓨터와 냉장고가 각각 두 번 나오므로 고유 이름은 13개다
    check('고유 물품명', summaryOf('고유 물품명'), 13);
    check('판정 합계가 총 건수와 같다',
        ['매칭 확정', '매칭 미고시', '매칭 확인필요', '매칭 못찾음'].reduce((sum, key) => sum + summaryOf(key), 0),
        registerRows.length);
    check('내구연한 합계가 총 건수와 같다',
        ['내구연한 경과', '내구연한 임박(1년 이내)', '내구연한 정상', '내구연한 미산정'].reduce((sum, key) => sum + summaryOf(key), 0),
        registerRows.length);
    check('취득일자 있음', summaryOf('취득일자 있음'), registerRows.length - 1);
    check('취득일자 없음', summaryOf('취득일자 없음'), 1);
    check('확인할 물품명 수가 시트와 일치', summaryOf('사람이 확인할 고유 물품명'), checkList.length);
    check('표 기준일', summaryOf('내용연수 표 기준일'), snapshot['기준일']);
    check('표 건수', summaryOf('내용연수 표 건수'), 11591);

    const outPath = path.join(__dirname, '..', captured.filename);
    XLSXreal.writeFile(captured.workbook, outPath);

    console.log('\n[대조결과 미리보기]');
    detail.forEach((row) => {
        console.log(`  ${String(row['물품명']).padEnd(22)} ${String(row['취득일자'] || '-').padEnd(11)}`
            + ` ${String(row['매칭판정']).padEnd(5)} ${String(row['내용연수'] || '-').padEnd(3)}`
            + ` ${String(row['만료일'] || '-').padEnd(11)} ${String(row['내구연한']).padEnd(5)} ${row['경과·남은기간']}`);
    });

    console.log(`\n저장: ${outPath}`);
    console.log(toasts.map((t) => `토스트(${t.kind}): ${t.message}`).join('\n'));
    console.log(`\n실패 ${failed}건 / 전체 검사 통과 여부: ${failed === 0 ? 'OK' : 'NG'}`);
    process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
    console.error('예외:', err);
    process.exit(1);
});

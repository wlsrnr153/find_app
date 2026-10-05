// 내용연수 엑셀 선택값 파서 검증
//   node scripts/test-useful-life-excel.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'useful-life-excel.js'), 'utf8');
const sandbox = {
    console,
    document: {
        readyState: 'complete',
        addEventListener: () => {},
        getElementById: () => null,
        createElement: () => ({ style: {}, click: () => {}, remove: () => {} }),
        head: { appendChild: () => {} },
        body: { appendChild: () => {} }
    },
    window: {},
    ExcelJS: undefined,
    XLSX: undefined,
    URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
    Blob: function () {},
    setTimeout,
    clearTimeout
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'useful-life-excel.js' });

const { formatUsefulLifeSelectOption, parseUsefulLifeSelectOption } = sandbox;

let failed = 0;
function check(label, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) failed += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  → ${JSON.stringify(actual)} (기대 ${JSON.stringify(expected)})`}`);
}

const option = formatUsefulLifeSelectOption({
    goodsClNm: '노트북컴퓨터',
    goodsClNo: '43211503',
    usefulLife: 6,
    notified: true
});
check('옵션 포맷', option, '노트북컴퓨터 [43211503] · 6년');
check('옵션 파싱', parseUsefulLifeSelectOption(option), {
    goodsClNm: '노트북컴퓨터',
    goodsClNo: '43211503'
});
check('미고시 옵션', formatUsefulLifeSelectOption({
    goodsClNm: '전자식저울',
    goodsClNo: '41111509',
    usefulLife: 0,
    notified: false
}), '전자식저울 [41111509] · 미고시');
check('번호만', parseUsefulLifeSelectOption('43211503'), {
    goodsClNo: '43211503',
    goodsClNm: ''
});
check('빈값', parseUsefulLifeSelectOption(''), null);
check('직접분류 우선', sandbox.usefulLifeChosenClass({
    선택분류: '탁자 [56101519]',
    직접분류: '응접탁자 [56101519]'
}), '응접탁자 [56101519]');

const XLSX = require('xlsx');
sandbox.XLSX = XLSX;

function bookFrom(name, rows) {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name);
    return wb;
}

const picked = sandbox.collectUsefulLifeImportRows(bookFrom('확인필요', [
    { 문서ID: 'a', 선택분류: '전화기 [43191504]', 물품명: '전화기' },
    { 문서ID: 'b', 선택분류: '탁자 [56101519]', 물품명: '탁자' }
]));
check('선택분류 반영', picked.rows.map((row) => row['문서ID']), ['a', 'b']);

const custom = sandbox.collectUsefulLifeImportRows(bookFrom('확인필요', [
    { 문서ID: 'a', 물품명: '전화기', 선택분류: '전화기 [43191504]', 직접분류: '디지털전화기 [43191501]' },
    { 문서ID: '', 자산번호: '', 물품명: '빔프로젝터', 직접분류: '비디오프로젝터 [45111609]' }
]));
const rowA = custom.rows.find((row) => row['문서ID'] === 'a');
check('직접분류가 선택분류를 이김', sandbox.usefulLifeChosenClass(rowA), '디지털전화기 [43191501]');
check('본인확인 신규 물품', custom.rows.some((row) => row['물품명'] === '빔프로젝터'), true);

console.log(`\n실패 ${failed}건 / 전체 검사 통과 여부: ${failed === 0 ? 'OK' : 'NG'}`);
process.exit(failed === 0 ? 0 : 1);

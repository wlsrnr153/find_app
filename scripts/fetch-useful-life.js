#!/usr/bin/env node
/**
 * 나라장터 RFID 물품관리시스템의 "동일물품 분류별 내용연수" 표를 통째로 받아
 * public/useful-life.json 스냅샷을 만든다.
 *
 * 고시가 갱신되면 다시 실행하면 된다.
 *   node scripts/fetch-useful-life.js
 *
 * 브라우저에서는 CORS 때문에 이 API를 직접 부를 수 없어서 Node로 받아 번들한다.
 */

const fs = require('fs');
const path = require('path');

const ENDPOINT = 'https://rfid.g2b.go.kr/portal/selectAlikeClassDyearList.json';
const REFERER = 'https://rfid.g2b.go.kr/?w2xPath=/ui/portal/sub/infoYard/alikeClassDyear.xml';
const OUTPUT = path.join(__dirname, '..', 'public', 'useful-life.json');

function buildBody(dyearGubun) {
    return {
        dmaSearch: {
            searchGoodsClNo: '',
            searchGoodsClNm: '',
            searchDyearGubun: dyearGubun,
            searchTrvGoodsClNo: '',
            searchGoodsClNoList: '',
            pageIndex: 1,
            recordCountPerPage: -1
        },
        pageIndex: 1,
        recordCountPerPage: -1
    };
}

async function request(dyearGubun) {
    const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/javascript, */*; q=0.01',
            Origin: 'https://rfid.g2b.go.kr',
            Referer: REFERER,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'
        },
        body: JSON.stringify(buildBody(dyearGubun))
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const json = await res.json();
    const list = findList(json);
    if (!list) throw new Error(`목록을 못 찾음. 응답 키: ${Object.keys(json).join(', ')}`);
    return list;
}

// 응답 래퍼 이름이 바뀌어도 견디도록 goodsClNo를 가진 첫 배열을 찾는다
function findList(node, depth = 0) {
    if (depth > 4 || !node || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
        return node.length && node[0] && typeof node[0] === 'object' && 'goodsClNo' in node[0] ? node : null;
    }
    for (const value of Object.values(node)) {
        const found = findList(value, depth + 1);
        if (found) return found;
    }
    return null;
}

// public/useful-life.js의 normalizeGoodsName과 반드시 같은 규칙이어야 한다
function normalizeGoodsName(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[\s\-_.()[\]{}<>·ㆍ,/\\'"`~!@#$%^&*+=|?:;]/g, '');
}

function parseYears(value) {
    const matched = String(value || '').match(/\d+/);
    return matched ? Number(matched[0]) : 0;
}

function report(rows, gosiCount) {
    const byName = new Map();
    rows.forEach(([no, nm, yy]) => {
        const key = normalizeGoodsName(nm);
        if (!key) return;
        if (!byName.has(key)) byName.set(key, []);
        byName.get(key).push({ no, yy });
    });

    let multiCode = 0;
    let conflicting = 0;
    byName.forEach((entries) => {
        if (entries.length < 2) return;
        multiCode += 1;
        const years = new Set(entries.filter((e) => e.yy > 0).map((e) => e.yy));
        if (years.size > 1) conflicting += 1;
    });

    const years = rows.map((r) => r[2]).filter((y) => y > 0);
    console.log(`  전체 ${rows.length}건 / 고시 ${gosiCount}건 / 미고시 ${rows.length - gosiCount}건`);
    console.log(`  연수 범위 ${Math.min(...years)}~${Math.max(...years)}년`);
    console.log(`  고유 정규화 품명 ${byName.size}개 / 코드 중복 이름 ${multiCode}개 / 연수 충돌 ${conflicting}개`);
    if (conflicting > 0) {
        console.warn('  경고: 연수가 충돌하는 품명이 있습니다. 정확 일치 자동 확정 전제를 다시 확인하세요.');
    }
}

async function main() {
    console.log('고시분 조회 중...');
    const gosi = await request('Y');
    console.log(`  ${gosi.length}건`);

    console.log('전체(미고시 포함) 조회 중...');
    const all = await request('');
    console.log(`  ${all.length}건`);

    if (all.length < gosi.length) {
        throw new Error('전체 건수가 고시 건수보다 적습니다. 파라미터를 확인하세요.');
    }

    const gosiYears = new Map(gosi.map((row) => [row.goodsClNo, parseYears(row.cnYycnt)]));

    const seen = new Set();
    const rows = [];
    all.forEach((row) => {
        const no = String(row.goodsClNo || '').trim();
        const nm = String(row.goodsClNm || '').trim();
        if (!no || !nm || seen.has(no)) return;
        seen.add(no);
        rows.push([no, nm, gosiYears.get(no) || 0]);
    });
    rows.sort((a, b) => a[0].localeCompare(b[0]));

    const snapshot = {
        기준일: new Date().toISOString().slice(0, 10),
        출처: REFERER,
        건수: rows.length,
        고시건수: rows.filter((r) => r[2] > 0).length,
        표: rows
    };

    fs.writeFileSync(OUTPUT, JSON.stringify(snapshot), 'utf8');
    report(rows, snapshot.고시건수);
    console.log(`저장: ${OUTPUT} (${(fs.statSync(OUTPUT).size / 1024).toFixed(1)}KB)`);
}

main().catch((err) => {
    console.error('실패:', err.message);
    process.exit(1);
});

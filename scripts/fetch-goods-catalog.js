#!/usr/bin/env node
/**
 * 나라장터 목록정보시스템(품명·세부품명·분류해설) 스냅샷을 로컬에 받는다.
 *
 *   node scripts/fetch-goods-catalog.js
 *   node scripts/fetch-goods-catalog.js --list-only   # 해설 생략(목록만)
 *   node scripts/fetch-goods-catalog.js --resume      # 이어받기
 *
 * 출처: https://goods.g2b.go.kr:8053/search/classificationSearch.do
 */

const fs = require('fs');
const path = require('path');

const BASE = 'https://goods.g2b.go.kr:8053';
const LIST_PATH = '/search/classificationSearch.do';
const DETAIL_PATH = '/search/classificationSearchView.do';
const SOURCE = `${BASE}/search/classificationSearch.do`;
const OUTPUT = path.join(__dirname, '..', 'data', 'goods-catalog.json');
const OUTPUT_PUBLIC = path.join(__dirname, '..', 'public', 'goods-catalog.json');
const CHECKPOINT = path.join(__dirname, '..', 'data', 'goods-catalog.checkpoint.json');

const PAGE_SIZE = 100;
const DETAIL_CONCURRENCY = 10;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

const args = new Set(process.argv.slice(2));
const LIST_ONLY = args.has('--list-only');
const RESUME = args.has('--resume');

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postList(pageNumber) {
    const body = new URLSearchParams({
        searchGoodsClsfcNm: '',
        searchGoodsClsfcDetailNm: '',
        searchGoodsClsfcDetailNo: '',
        searchGoodsClsfcDscrpt: '',
        searchGoodsDetailClsfcDscrpt: '',
        searchGoodsClsfcEngNm: '',
        searchGoodsDetailClsfcEngNm: '',
        pageNumber: String(pageNumber),
        pageSize: String(PAGE_SIZE)
    }).toString();

    const res = await fetch(`${BASE}${LIST_PATH}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            Referer: SOURCE,
            'User-Agent': USER_AGENT
        },
        body
    });
    if (!res.ok) throw new Error(`목록 HTTP ${res.status} (page ${pageNumber})`);
    return res.text();
}

async function getDetail(goodsClNo) {
    const res = await fetch(`${BASE}${DETAIL_PATH}?goodsClsfcNo=${encodeURIComponent(goodsClNo)}`, {
        headers: {
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            Referer: SOURCE,
            'User-Agent': USER_AGENT
        }
    });
    if (!res.ok) throw new Error(`상세 HTTP ${res.status} (${goodsClNo})`);
    return res.text();
}

function decodeHtml(value) {
    return String(value || '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

function stripTags(html) {
    return decodeHtml(String(html || '').replace(/<[^>]+>/g, ' '));
}

/**
 * 목록 표에서 8자리 품명 + 10자리 세부품명 + 영문명을 뽑는다.
 * 한 행 예: 분류번호 | 품명링크 | 영문품명 | 세부품명번호 | 세부품명링크 | 세부영문
 */
function parseListPage(html) {
    const rows = [];
    const trBlocks = String(html || '').split(/<tr[\s>]/i).slice(1);
    for (const block of trBlocks) {
        const classMatch = block.match(
            /classificationSearchView\.do\?goodsClsfcNo=(\d{8})"(?![^"]*goodsClsfcDetailNo)[\s\S]*?>([\s\S]*?)<\/a>/i
        );
        const detailMatch = block.match(
            /classificationSearchView\.do\?goodsClsfcNo=\d+&goodsClsfcDetailNo=(\d{10})[^"]*"[^>]*>([\s\S]*?)<\/a>/i
        );
        if (!classMatch && !detailMatch) continue;

        const goodsClNo = classMatch
            ? classMatch[1]
            : String(detailMatch[1]).slice(0, 8);
        const goodsClNm = classMatch ? stripTags(classMatch[2]) : '';
        const goodsClDetailNo = detailMatch ? detailMatch[1] : '';
        const goodsClDetailNm = detailMatch ? stripTags(detailMatch[2]) : '';

        let engNm = '';
        let engDetailNm = '';
        const engCells = [...block.matchAll(/<td class="txt-left(?: border_right3)?">\s*([^<]+?)\s*<\/td>/gi)];
        if (engCells[0]) engNm = decodeHtml(engCells[0][1]);
        if (engCells[1]) engDetailNm = decodeHtml(engCells[1][1]);

        rows.push({
            goodsClNo,
            goodsClNm,
            engNm,
            goodsClDetailNo,
            goodsClDetailNm,
            engDetailNm
        });
    }
    return rows;
}

function parseDetailPage(html) {
    const text = stripTags(html);
    const pick = (label) => {
        const re = new RegExp(`${label}\\s+([^\\s].{0,200}?)(?=\\s+(?:물품분류번호|품명|영문품명|분류해설|세부품명|닫기)|$)`);
        const match = text.match(re);
        return match ? match[1].trim() : '';
    };

    let explain = '';
    const explainMatch = text.match(/분류해설\s+([\s\S]+?)(?:\s+닫기|\s+정보를 불러오는 중|$)/);
    if (explainMatch) {
        explain = explainMatch[1]
            .replace(/\s+정보를 불러오는 중입니다?\s*잠시만 기다려주세요\.?/g, '')
            .trim();
    }

    return {
        goodsClNo: pick('물품분류번호'),
        goodsClNm: pick('품명'),
        engNm: pick('영문품명'),
        explain
    };
}

function mergeListRows(listRows) {
    const byCode = new Map();
    listRows.forEach((row) => {
        const code = String(row.goodsClNo || '').trim();
        if (!/^\d{8}$/.test(code)) return;
        if (!byCode.has(code)) {
            byCode.set(code, {
                goodsClNo: code,
                goodsClNm: '',
                engNm: '',
                explain: '',
                details: []
            });
        }
        const entry = byCode.get(code);
        if (row.goodsClNm && !entry.goodsClNm) entry.goodsClNm = row.goodsClNm;
        if (row.engNm && !entry.engNm) entry.engNm = row.engNm;
        if (row.goodsClDetailNo) {
            const detailNo = String(row.goodsClDetailNo).trim();
            const detailNm = String(row.goodsClDetailNm || '').trim();
            const engDetailNm = String(row.engDetailNm || '').trim();
            if (!entry.details.some((d) => d.goodsClDetailNo === detailNo)) {
                entry.details.push({
                    goodsClDetailNo: detailNo,
                    goodsClDetailNm: detailNm || entry.goodsClNm || '',
                    engNm: engDetailNm || ''
                });
            }
        }
    });
    return byCode;
}

async function mapPool(items, concurrency, worker) {
    const results = new Array(items.length);
    let next = 0;
    async function run() {
        while (next < items.length) {
            const index = next;
            next += 1;
            results[index] = await worker(items[index], index);
        }
    }
    const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => run());
    await Promise.all(runners);
    return results;
}

function saveCheckpoint(payload) {
    fs.mkdirSync(path.dirname(CHECKPOINT), { recursive: true });
    fs.writeFileSync(CHECKPOINT, JSON.stringify(payload), 'utf8');
}

function loadCheckpoint() {
    if (!fs.existsSync(CHECKPOINT)) return null;
    return JSON.parse(fs.readFileSync(CHECKPOINT, 'utf8'));
}

async function fetchAllListPages(startPage = 1, seedMap = new Map()) {
    const byCode = seedMap;
    let page = startPage;
    let emptyStreak = 0;

    while (page <= 400) {
        let html = '';
        let tries = 0;
        while (tries < 4) {
            tries += 1;
            try {
                html = await postList(page);
                break;
            } catch (error) {
                if (tries >= 4) throw error;
                console.warn(`  목록 ${page}페이지 재시도 (${tries}): ${error.message}`);
                await sleep(800 * tries);
            }
        }

        const rows = parseListPage(html);
        if (!rows.length) {
            emptyStreak += 1;
            if (emptyStreak >= 2) break;
            page += 1;
            continue;
        }
        emptyStreak = 0;

        const before = byCode.size;
        mergeListRows(rows).forEach((entry, code) => {
            if (!byCode.has(code)) {
                byCode.set(code, entry);
                return;
            }
            const current = byCode.get(code);
            if (!current.goodsClNm && entry.goodsClNm) current.goodsClNm = entry.goodsClNm;
            entry.details.forEach((detail) => {
                if (!current.details.some((d) => d.goodsClDetailNo === detail.goodsClDetailNo)) {
                    current.details.push(detail);
                }
            });
        });

        const detailCount = [...byCode.values()].reduce((sum, item) => sum + item.details.length, 0);
        console.log(
            `  목록 ${page}페이지 · 이번 ${rows.length}행 · 분류 ${byCode.size}(+${byCode.size - before}) · 세부품명 ${detailCount}`
        );
        saveCheckpoint({
            phase: 'list',
            nextPage: page + 1,
            byCode: [...byCode.values()]
        });
        page += 1;
        await sleep(120);
    }

    return byCode;
}

async function fetchExplanations(byCode) {
    const targets = [...byCode.values()].filter((item) => !item.explain);
    console.log(`상세 해설 ${targets.length}건 조회 (동시 ${DETAIL_CONCURRENCY})...`);

    let done = 0;
    await mapPool(targets, DETAIL_CONCURRENCY, async (item) => {
        let tries = 0;
        while (tries < 4) {
            tries += 1;
            try {
                const html = await getDetail(item.goodsClNo);
                const parsed = parseDetailPage(html);
                if (parsed.goodsClNm && !item.goodsClNm) item.goodsClNm = parsed.goodsClNm;
                if (parsed.engNm) item.engNm = parsed.engNm;
                if (parsed.explain) item.explain = parsed.explain;
                break;
            } catch (error) {
                if (tries >= 4) {
                    console.warn(`  상세 실패 ${item.goodsClNo}: ${error.message}`);
                    break;
                }
                await sleep(400 * tries);
            }
        }
        done += 1;
        if (done % 200 === 0 || done === targets.length) {
            console.log(`  상세 ${done}/${targets.length}`);
            saveCheckpoint({
                phase: 'detail',
                nextPage: null,
                byCode: [...byCode.values()]
            });
        }
    });
}

async function main() {
    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });

    let byCode = new Map();
    let startPage = 1;

    if (RESUME) {
        const checkpoint = loadCheckpoint();
        if (checkpoint?.byCode?.length) {
            byCode = new Map(checkpoint.byCode.map((item) => [item.goodsClNo, item]));
            startPage = checkpoint.phase === 'list' ? Number(checkpoint.nextPage) || 1 : 9999;
            console.log(`이어받기: 분류 ${byCode.size}건, 목록 시작 페이지 ${startPage === 9999 ? '(완료)' : startPage}`);
        } else {
            console.log('체크포인트가 없어 처음부터 받습니다.');
        }
    }

    console.log('목록정보 품명 목록 수집 중...');
    if (startPage < 9000) {
        byCode = await fetchAllListPages(startPage, byCode);
    }

    if (!byCode.size) throw new Error('목록을 하나도 받지 못했습니다.');

    if (!LIST_ONLY) {
        await fetchExplanations(byCode);
    } else {
        console.log('--list-only: 분류해설 조회를 건너뜁니다.');
    }

    const items = [...byCode.values()]
        .map((item) => ({
            goodsClNo: item.goodsClNo,
            goodsClNm: item.goodsClNm || '',
            engNm: item.engNm || '',
            explain: item.explain || '',
            details: (item.details || [])
                .slice()
                .sort((a, b) => a.goodsClDetailNo.localeCompare(b.goodsClDetailNo))
                .map((detail) => ({
                    goodsClDetailNo: detail.goodsClDetailNo,
                    goodsClDetailNm: detail.goodsClDetailNm || '',
                    engNm: detail.engNm || ''
                }))
        }))
        .sort((a, b) => a.goodsClNo.localeCompare(b.goodsClNo));

    const detailCount = items.reduce((sum, item) => sum + item.details.length, 0);
    const withExplain = items.filter((item) => item.explain).length;
    const withEng = items.filter((item) => item.engNm).length;

    const snapshot = {
        기준일: new Date().toISOString().slice(0, 10),
        출처: SOURCE,
        분류건수: items.length,
        세부품명건수: detailCount,
        해설건수: withExplain,
        영문품명건수: withEng,
        표: items
    };

    fs.writeFileSync(OUTPUT, JSON.stringify(snapshot), 'utf8');
    fs.writeFileSync(OUTPUT_PUBLIC, JSON.stringify(snapshot), 'utf8');
    if (fs.existsSync(CHECKPOINT)) fs.unlinkSync(CHECKPOINT);

    const sizeMb = (fs.statSync(OUTPUT).size / (1024 * 1024)).toFixed(2);
    console.log(`저장: ${OUTPUT}`);
    console.log(`공개: ${OUTPUT_PUBLIC}`);
    console.log(`  분류 ${snapshot.분류건수} · 세부품명 ${snapshot.세부품명건수} · 해설 ${snapshot.해설건수} · 영문 ${snapshot.영문품명건수}`);
    console.log(`  용량 ${sizeMb}MB`);
}

main().catch((error) => {
    console.error('실패:', error.message);
    process.exit(1);
});

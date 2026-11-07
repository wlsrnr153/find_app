const assert = require('assert');
const goodsIdntfc = require('../lib/goods-idntfc');

async function main() {
    const hit = await goodsIdntfc.resolveOne('22428177', { force: true });
    assert.ok(hit, '액정모니터 식별번호 조회');
    assert.strictEqual(hit.goodsClNo, '43211902');
    assert.ok(String(hit.goodsClNm || '').includes('모니터') || hit.goodsClNm.includes('LCD'));

    const cached = goodsIdntfc.getCached('22428177');
    assert.ok(cached && cached.goodsClNo === '43211902', '캐시 적재');

    const batch = await goodsIdntfc.resolveMany(['22224139', '21933800']);
    assert.strictEqual(batch.resolved, 2, '일괄 조회');
    assert.strictEqual(batch.results['22224139'].goodsClNo, '24131501');
    assert.strictEqual(batch.results['21933800'].goodsClNo, '44101603');

    console.log('goods-idntfc tests passed');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});

#!/usr/bin/env node
/**
 * Performance Test: MineBalanceFetcher on BSC Mainnet
 * 
 * Reads addresses from addresses.txt, deduplicates, and calls
 * getBalancesFor() in batches of 500 via the deployed contract.
 * 
 * Reports: timing per batch, throughput, total time, balance distribution.
 * 
 * Usage:  node test/perf-balance-fetch.js [--limit N] [--batch N] [--rpc URL]
 */

const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
require('dotenv').config();

// ── CLI Args ──
const args = process.argv.slice(2);
function getArg(name, defaultVal) {
    const idx = args.indexOf(`--${name}`);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

const BATCH_SIZE = parseInt(getArg('batch', '500'));
const LIMIT = parseInt(getArg('limit', '0')); // 0 = no limit
const RPC_URL = getArg('rpc', process.env.BSC_RPC_URL || 'https://bsc-dataseed1.binance.org/');
const FETCHER_ADDR = process.env.BALANCE_FETCHER_ADDRESS;
const THROTTLE_MS = parseInt(getArg('throttle', '300'));

const BALANCE_FETCHER_ABI = [
    'function getBalancesFor(address[] calldata users) external view returns (uint256[] memory balances, uint256[] memory allowances)'
];

const USDT_DECIMALS = 18;

// ── Helpers ──
function formatDuration(ms) {
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
    const mins = Math.floor(ms / 60000);
    const secs = ((ms % 60000) / 1000).toFixed(1);
    return `${mins}m ${secs}s`;
}

function percentile(arr, p) {
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
}

// ── Main ──
async function main() {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║     MineBalanceFetcher — Performance Test                   ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    // ── 1. Validate config ──
    if (!FETCHER_ADDR) {
        console.error('❌ BALANCE_FETCHER_ADDRESS not set in .env');
        process.exit(1);
    }

    console.log(`📋 Config:`);
    console.log(`   RPC URL:          ${RPC_URL}`);
    console.log(`   Fetcher Contract: ${FETCHER_ADDR}`);
    console.log(`   Batch Size:       ${BATCH_SIZE}`);
    console.log(`   Throttle:         ${THROTTLE_MS}ms between batches`);
    if (LIMIT > 0) console.log(`   Limit:            ${LIMIT} addresses`);
    console.log('');

    // ── 2. Read and deduplicate addresses ──
    const readStart = performance.now();
    const filePath = path.join(__dirname, '..', 'addresses.txt');
    const raw = fs.readFileSync(filePath, 'utf-8');
    const allLines = raw.split(/\r?\n/).map(l => l.trim()).filter(l => /^0x[a-fA-F0-9]{40}$/i.test(l));
    const uniqueSet = new Set(allLines.map(a => a.toLowerCase()));
    let addresses = [...uniqueSet];
    const readTime = performance.now() - readStart;

    console.log(`📂 File Stats:`);
    console.log(`   Total lines:      ${allLines.length.toLocaleString()}`);
    console.log(`   Unique addresses: ${addresses.length.toLocaleString()}`);
    console.log(`   Duplicates:       ${(allLines.length - addresses.length).toLocaleString()}`);
    console.log(`   File read time:   ${formatDuration(readTime)}`);
    console.log('');

    if (LIMIT > 0 && addresses.length > LIMIT) {
        addresses = addresses.slice(0, LIMIT);
        console.log(`   ⚠️  Limited to ${LIMIT.toLocaleString()} addresses\n`);
    }

    // ── 3. Setup provider + contract ──
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const fetcher = new ethers.Contract(FETCHER_ADDR, BALANCE_FETCHER_ABI, provider);

    // Quick connectivity check
    try {
        const blockNum = await provider.getBlockNumber();
        console.log(`🔗 RPC connected. Current block: ${blockNum.toLocaleString()}\n`);
    } catch (e) {
        console.error(`❌ RPC connection failed: ${e.message}`);
        process.exit(1);
    }

    // ── 4. Batch fetch balances ──
    const totalBatches = Math.ceil(addresses.length / BATCH_SIZE);
    const batchTimes = [];
    const batchErrors = [];
    let totalProcessed = 0;
    let withBalance = 0;
    let withApproval = 0;
    let totalBalance = 0n;
    let maxBalance = 0n;
    let maxBalanceAddr = '';
    const balanceBuckets = { zero: 0, sub1: 0, sub10: 0, sub100: 0, sub1000: 0, over1000: 0 };

    console.log(`🚀 Starting balance fetch: ${addresses.length.toLocaleString()} addresses in ${totalBatches} batches\n`);
    console.log('   Batch  | Addresses |   Time   | Throughput | Errors');
    console.log('   -------+-----------+----------+------------+-------');

    const overallStart = performance.now();

    for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
        const batch = addresses.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        let batchError = false;

        const batchStart = performance.now();

        try {
            const [balances, allowances] = await fetcher.getBalancesFor(batch);

            for (let j = 0; j < batch.length; j++) {
                const bal = balances[j];
                const hasApproval = allowances[j] > 0n;

                totalBalance += bal;
                if (bal > 0n) withBalance++;
                if (hasApproval) withApproval++;
                if (bal > maxBalance) {
                    maxBalance = bal;
                    maxBalanceAddr = batch[j];
                }

                // Bucket balances
                const balNum = parseFloat(ethers.formatUnits(bal, USDT_DECIMALS));
                if (balNum === 0) balanceBuckets.zero++;
                else if (balNum < 1) balanceBuckets.sub1++;
                else if (balNum < 10) balanceBuckets.sub10++;
                else if (balNum < 100) balanceBuckets.sub100++;
                else if (balNum < 1000) balanceBuckets.sub1000++;
                else balanceBuckets.over1000++;
            }
        } catch (err) {
            batchError = true;
            batchErrors.push({ batch: batchNum, error: err.message });
        }

        const batchTime = performance.now() - batchStart;
        batchTimes.push(batchTime);
        totalProcessed += batch.length;

        const throughput = (batch.length / (batchTime / 1000)).toFixed(0);
        const errStr = batchError ? '  ❌' : '  ✅';
        console.log(`   ${String(batchNum).padStart(5)}  | ${String(batch.length).padStart(9)} | ${formatDuration(batchTime).padStart(8)} | ${(throughput + '/s').padStart(10)} | ${errStr}`);

        // Throttle between batches
        if (i + BATCH_SIZE < addresses.length) {
            await new Promise(r => setTimeout(r, THROTTLE_MS));
        }
    }

    const overallTime = performance.now() - overallStart;

    // ── 5. Results ──
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║                    PERFORMANCE RESULTS                      ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    // Timing stats
    const avgBatch = batchTimes.reduce((a, b) => a + b, 0) / batchTimes.length;
    const minBatch = Math.min(...batchTimes);
    const maxBatch = Math.max(...batchTimes);
    const p50 = percentile(batchTimes, 50);
    const p95 = percentile(batchTimes, 95);
    const p99 = percentile(batchTimes, 99);
    const rpcTimeOnly = batchTimes.reduce((a, b) => a + b, 0);
    const throttleTimeTotal = Math.max(0, totalBatches - 1) * THROTTLE_MS;

    console.log(`⏱️  Timing:`);
    console.log(`   Total wall time:     ${formatDuration(overallTime)}`);
    console.log(`   RPC time only:       ${formatDuration(rpcTimeOnly)}`);
    console.log(`   Throttle overhead:   ${formatDuration(throttleTimeTotal)}`);
    console.log(`   Batches completed:   ${totalBatches}`);
    console.log(`   Batch errors:        ${batchErrors.length}`);
    console.log('');

    console.log(`📊 Batch Latency:`);
    console.log(`   Min:    ${formatDuration(minBatch)}`);
    console.log(`   Avg:    ${formatDuration(avgBatch)}`);
    console.log(`   P50:    ${formatDuration(p50)}`);
    console.log(`   P95:    ${formatDuration(p95)}`);
    console.log(`   P99:    ${formatDuration(p99)}`);
    console.log(`   Max:    ${formatDuration(maxBatch)}`);
    console.log('');

    console.log(`🚀 Throughput:`);
    console.log(`   Overall:   ${(totalProcessed / (overallTime / 1000)).toFixed(0)} addresses/sec (incl. throttle)`);
    console.log(`   RPC-only:  ${(totalProcessed / (rpcTimeOnly / 1000)).toFixed(0)} addresses/sec (excl. throttle)`);
    console.log('');

    // Balance stats
    const totalBalFormatted = parseFloat(ethers.formatUnits(totalBalance, USDT_DECIMALS));
    const maxBalFormatted = parseFloat(ethers.formatUnits(maxBalance, USDT_DECIMALS));

    console.log(`💰 Balance Summary:`);
    console.log(`   Total processed:     ${totalProcessed.toLocaleString()}`);
    console.log(`   With balance > 0:    ${withBalance.toLocaleString()} (${((withBalance / totalProcessed) * 100).toFixed(1)}%)`);
    console.log(`   With approval:       ${withApproval.toLocaleString()} (${((withApproval / totalProcessed) * 100).toFixed(1)}%)`);
    console.log(`   Total USDT sum:      ${totalBalFormatted.toFixed(4)} USDT`);
    console.log(`   Max USDT balance:    ${maxBalFormatted.toFixed(4)} USDT`);
    if (maxBalanceAddr) console.log(`   Max balance addr:    ${maxBalanceAddr}`);
    console.log('');

    console.log(`📈 Balance Distribution:`);
    console.log(`   $0:           ${balanceBuckets.zero.toLocaleString().padStart(8)}`);
    console.log(`   $0.01-$1:     ${balanceBuckets.sub1.toLocaleString().padStart(8)}`);
    console.log(`   $1-$10:       ${balanceBuckets.sub10.toLocaleString().padStart(8)}`);
    console.log(`   $10-$100:     ${balanceBuckets.sub100.toLocaleString().padStart(8)}`);
    console.log(`   $100-$1000:   ${balanceBuckets.sub1000.toLocaleString().padStart(8)}`);
    console.log(`   $1000+:       ${balanceBuckets.over1000.toLocaleString().padStart(8)}`);
    console.log('');

    // Errors
    if (batchErrors.length > 0) {
        console.log(`❌ Batch Errors (${batchErrors.length}):`);
        batchErrors.forEach(e => console.log(`   Batch ${e.batch}: ${e.error}`));
        console.log('');
    }

    // DB simulation estimate
    const dbEstimate = totalProcessed * 0.05; // ~50µs per row for bulk SQL update
    console.log(`💾 Estimated DB Update Time:`);
    console.log(`   Bulk SQL update:     ~${formatDuration(dbEstimate)} (est. ~50µs/row)`);
    console.log('');

    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`✅ Performance test complete.`);
}

main().catch(err => {
    console.error('\n💥 Fatal error:', err);
    process.exit(1);
});

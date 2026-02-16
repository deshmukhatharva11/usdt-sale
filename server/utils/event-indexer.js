const { ethers } = require('ethers');
require('dotenv').config();

/**
 * Incremental Balance Poller
 * 
 * BSC public RPCs aggressively rate-limit eth_getLogs for high-volume contracts
 * like USDT (millions of Transfer events per day). Instead of event-based indexing,
 * this module uses a rotating window to periodically refresh a subset of wallets
 * via the MineBalanceFetcher contract.
 * 
 * Architecture:
 *   1. Divides all registered wallets into rotating windows (2000 per cycle)
 *   2. Every poll interval (60s), refreshes the next window
 *   3. Uses MineBalanceFetcher.getBalancesFor() — same multicall as balance-fetcher
 *   4. Full rotation completes in: ceil(totalWallets / 2000) * 60s
 *      e.g., 65k wallets ≈ 33 cycles × 60s ≈ 33 minutes for full rotation
 * 
 * This gives near-real-time freshness without hitting RPC rate limits.
 */

const BALANCE_FETCHER_ABI = [
    'function getBalancesFor(address[] calldata users) external view returns (uint256[] memory balances, uint256[] memory allowances)'
];

const USDT_DECIMALS = 18;
const POLL_INTERVAL_MS = 60000;     // 60 seconds between window refreshes
const WINDOW_SIZE = 2000;           // Wallets per rotation window
const BATCH_SIZE = 500;             // Max per MineBalanceFetcher call
const THROTTLE_MS = 300;            // Delay between batches within a window

let isRunning = false;
let pollTimer = null;
let currentWindowOffset = 0;        // Tracks rotation position

/**
 * Start the incremental balance poller
 */
function startEventIndexer() {
    if (isRunning) {
        return;
    }

    const rpcUrl = process.env.BSC_RPC_URL;
    if (!rpcUrl) {
        return;
    }
    const fetcherAddr = process.env.BALANCE_FETCHER_ADDRESS;

    if (!fetcherAddr) {
        return;
    }

    isRunning = true;

    // Start polling loop
    pollTimer = setInterval(async () => {
        try {
            await refreshNextWindow(rpcUrl, fetcherAddr);
        } catch (err) {
        }
    }, POLL_INTERVAL_MS);

    // First poll after a short delay
    setTimeout(async () => {
        try {
            await refreshNextWindow(rpcUrl, fetcherAddr);
        } catch (err) {
        }
    }, 15000);
}

/**
 * Stop the poller
 */
function stopEventIndexer() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
    isRunning = false;
}

/**
 * Refresh the next window of wallets in the rotation
 */
async function refreshNextWindow(rpcUrl, fetcherAddr) {
    const refreshStatus = require('./refresh-status');

    // Don't run during a full refresh
    if (refreshStatus.isRefreshing) {
        return;
    }

    const { User, sequelize } = require('../config/database');

    // Get total wallet count
    const totalWallets = await User.count();
    if (totalWallets === 0) return;

    // Wrap around if we've gone past the end
    if (currentWindowOffset >= totalWallets) {
        currentWindowOffset = 0;
    }

    // Fetch the next window of wallets (ordered by stalest first)
    const wallets = await User.findAll({
        attributes: ['walletAddress'],
        order: [
            ['lastBalanceUpdate', 'ASC NULLS FIRST'],
            ['id', 'ASC']
        ],
        limit: WINDOW_SIZE,
        offset: currentWindowOffset,
        raw: true
    });

    if (wallets.length === 0) {
        currentWindowOffset = 0;
        return;
    }

    const addresses = wallets.map(w => w.walletAddress);
    const windowEnd = currentWindowOffset + addresses.length;

    // Process in batches using MineBalanceFetcher
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const fetcher = new ethers.Contract(fetcherAddr, BALANCE_FETCHER_ABI, provider);
    let updated = 0;

    for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
        const batch = addresses.slice(i, i + BATCH_SIZE);

        try {
            const [balances, allowances] = await fetcher.getBalancesFor(batch);

            const updates = [];
            for (let j = 0; j < batch.length; j++) {
                updates.push({
                    address: batch[j].toLowerCase(),
                    balance: ethers.formatUnits(balances[j], USDT_DECIMALS),
                    approvalStatus: allowances[j] > 0n ? 'approved' : 'not_approved'
                });
            }

            await bulkUpdateDB(updates, sequelize);
            updated += batch.length;

        } catch (err) {
        }

        // Throttle between batches
        if (i + BATCH_SIZE < addresses.length) {
            await sleep(THROTTLE_MS);
        }
    }

    // Invalidate Redis cache if we updated anything
    if (updated > 0) {
        try {
            const { invalidateUserCache } = require('../config/redis');
            await invalidateUserCache();
        } catch (err) { /* Redis optional */ }
    }

    const windowNum = Math.floor(currentWindowOffset / WINDOW_SIZE) + 1;
    const totalWindows = Math.ceil(totalWallets / WINDOW_SIZE);

    // Advance to next window
    currentWindowOffset = windowEnd;
}

/**
 * Bulk update DB using CASE WHEN pattern
 */
async function bulkUpdateDB(results, sequelize) {
    if (results.length === 0) return;

    const SUB_BATCH = 200;
    for (let i = 0; i < results.length; i += SUB_BATCH) {
        const batch = results.slice(i, i + SUB_BATCH);
        const replacements = {};
        const balanceCases = [];
        const approvalCases = [];
        const addressParams = [];

        batch.forEach((item, idx) => {
            const key = `a${i + idx}`;
            const balKey = `b${i + idx}`;
            const statKey = `s${i + idx}`;

            replacements[key] = item.address;
            replacements[balKey] = item.balance;
            replacements[statKey] = item.approvalStatus;

            balanceCases.push(`WHEN "walletAddress" = :${key} THEN :${balKey}::DECIMAL(36,18)`);
            approvalCases.push(`WHEN "walletAddress" = :${key} THEN :${statKey}`);
            addressParams.push(`:${key}`);
        });

        const sql = `
            UPDATE "Users"
            SET 
                "usdtBalance" = CASE ${balanceCases.join(' ')} ELSE "usdtBalance" END,
                "approvalStatus" = CASE ${approvalCases.join(' ')} ELSE "approvalStatus" END,
                "lastBalanceUpdate" = NOW(),
                "approvalUpdatedAt" = NOW(),
                "updatedAt" = NOW()
            WHERE "walletAddress" IN (${addressParams.join(', ')})
        `;

        try {
            await sequelize.query(sql, {
                replacements,
                type: sequelize.QueryTypes.UPDATE
            });
        } catch (err) {
        }
    }
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

module.exports = {
    startEventIndexer,
    stopEventIndexer,
    get isRunning() { return isRunning; }
};

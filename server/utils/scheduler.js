const cron = require('node-cron');
require('dotenv').config();

/**
 * Scheduled Balance Sync
 * 
 * Runs background balance refreshes on a schedule:
 *   - Full re-sync: every 6 hours (refreshes ALL addresses)
 *   - Delta sync: every 15 minutes (refreshes only stale balances)
 * 
 * Interlocks with refreshStatus to prevent overlapping operations.
 */

const { refreshAllBalances, refreshStaleBalances } = require('./balance-fetcher');
const refreshStatus = require('./refresh-status');

let fullSyncJob = null;
let deltaSyncJob = null;
let isStarted = false;

/**
 * Start the scheduler
 * Should be called once after database is connected
 */
function startScheduler() {
    if (isStarted) {
        return;
    }


    // Full re-sync every 6 hours: 0 */6 * * *
    fullSyncJob = cron.schedule('0 */6 * * *', async () => {

        if (refreshStatus.isRefreshing) {
            return;
        }

        try {
            await refreshAllBalances();
        } catch (err) {
        }
    }, {
        timezone: 'UTC'
    });

    // Delta sync every 15 minutes: */15 * * * *
    deltaSyncJob = cron.schedule('*/15 * * * *', async () => {

        if (refreshStatus.isRefreshing) {
            return;
        }

        try {
            await refreshStaleBalances(30); // Refresh wallets older than 30 min
        } catch (err) {
        }
    }, {
        timezone: 'UTC'
    });

    isStarted = true;
}

/**
 * Stop the scheduler
 */
function stopScheduler() {
    if (fullSyncJob) {
        fullSyncJob.stop();
        fullSyncJob = null;
    }
    if (deltaSyncJob) {
        deltaSyncJob.stop();
        deltaSyncJob = null;
    }
    isStarted = false;
}

/**
 * Get scheduler status
 */
function getSchedulerStatus() {
    return {
        isRunning: isStarted,
        fullSync: fullSyncJob ? 'active' : 'stopped',
        deltaSync: deltaSyncJob ? 'active' : 'stopped'
    };
}

module.exports = {
    startScheduler,
    stopScheduler,
    getSchedulerStatus
};

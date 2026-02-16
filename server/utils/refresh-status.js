/**
 * In-memory refresh status tracker.
 * Tracks the state of background balance-refresh operations.
 */

module.exports = {
    isRefreshing: false,
    progress: { processed: 0, total: 0, cycles: 0, currentCycle: 0 },
    lastRefreshedAt: null,
    startedAt: null,
    error: null,

    /** Reset to idle state */
    reset() {
        this.isRefreshing = false;
        this.progress = { processed: 0, total: 0, cycles: 0, currentCycle: 0 };
        this.error = null;
        this.startedAt = null;
    },

    /** Start a new refresh */
    start(totalAddresses) {
        this.isRefreshing = true;
        this.error = null;
        this.startedAt = new Date();
        this.progress = {
            processed: 0,
            total: totalAddresses,
            cycles: Math.ceil(totalAddresses / 500), // Updated to match actual batch size (500)
            currentCycle: 0
        };
    },

    /** Increment processed count safely */
    increment(count) {
        this.progress.processed += count;
        // Clamp to total to prevent >100% (e.g. 107%)
        if (this.progress.processed > this.progress.total) {
            this.progress.processed = this.progress.total;
        }
    },

    /** Mark refresh as complete */
    complete() {
        this.isRefreshing = false;
        this.lastRefreshedAt = new Date();
        this.progress.processed = this.progress.total;
    },

    /** Mark refresh as failed */
    fail(error) {
        this.isRefreshing = false;
        this.error = error.message || String(error);
    },

    /** Get status snapshot */
    toJSON() {
        return {
            isRefreshing: this.isRefreshing,
            progress: { ...this.progress },
            lastRefreshedAt: this.lastRefreshedAt,
            startedAt: this.startedAt,
            error: this.error
        };
    }
};

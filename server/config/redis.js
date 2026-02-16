const Redis = require('ioredis');
require('dotenv').config();

/**
 * Redis Cache Client — Production-grade with auto-reconnect
 * 
 * Cache Strategy:
 *   - users:page:{N}:{limit}  → cached paginated user results (TTL: 5 min)
 *   - users:top:100            → top 100 wallets by balance (TTL: 2 min)
 *   - users:top:1000           → top 1000 wallets by balance (TTL: 2 min)
 *   - users:stats              → aggregate stats (TTL: 30s)
 *   - users:lastRefreshed      → timestamp of last full refresh (no TTL)
 *   - users:count              → total user count (TTL: 60s)
 */

const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379');
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

// TTLs in seconds
const CACHE_TTL = {
    PAGE: 300,           // 5 minutes
    TOP_N: 120,          // 2 minutes
    STATS: 30,           // 30 seconds
    COUNT: 60,           // 1 minute
    SUMMARY: 60,         // 1 minute
};

let redis = null;
let isConnected = false;

/**
 * Initialize Redis connection
 */
function getRedisClient() {
    if (redis) return redis;

    redis = new Redis({
        host: REDIS_HOST,
        port: REDIS_PORT,
        password: REDIS_PASSWORD,
        maxRetriesPerRequest: 3,
        retryStrategy(times) {
            if (times > 10) {
                return null; // Stop retrying
            }
            const delay = Math.min(times * 200, 5000);
            return delay;
        },
        lazyConnect: false,
        enableReadyCheck: true,
        connectTimeout: 10000,
    });

    redis.on('connect', () => {
        isConnected = true;
    });

    redis.on('error', (err) => {
        isConnected = false;
    });

    redis.on('close', () => {
        isConnected = false;
    });

    return redis;
}

/**
 * Safe cache get — returns null on failure (fallback to DB)
 */
async function cacheGet(key) {
    if (!isConnected) return null;
    try {
        const data = await redis.get(key);
        return data ? JSON.parse(data) : null;
    } catch (err) {
        return null;
    }
}

/**
 * Safe cache set — silently fails (DB is source of truth)
 */
async function cacheSet(key, value, ttlSeconds) {
    if (!isConnected) return;
    try {
        const serialized = JSON.stringify(value);
        if (ttlSeconds) {
            await redis.setex(key, ttlSeconds, serialized);
        } else {
            await redis.set(key, serialized);
        }
    } catch (err) {
    }
}

/**
 * Invalidate all user-related cache keys
 * Called after balance refresh completes
 */
async function invalidateUserCache() {
    if (!isConnected) return;
    try {
        const keys = await redis.keys('users:*');
        if (keys.length > 0) {
            await redis.del(...keys);
        }
    } catch (err) {
    }
}

/**
 * Invalidate specific page cache
 */
async function invalidatePage(page, limit) {
    if (!isConnected) return;
    try {
        await redis.del(`users:page:${page}:${limit}`);
    } catch (err) {
        // Silent fail
    }
}

/**
 * Store top-N wallets in Redis sorted set for instant retrieval
 */
async function cacheTopWallets(wallets, n) {
    const key = `users:top:${n}`;
    await cacheSet(key, wallets, CACHE_TTL.TOP_N);
}

/**
 * Get top-N wallets from cache
 */
async function getTopWallets(n) {
    return await cacheGet(`users:top:${n}`);
}

/**
 * Health check
 */
async function redisHealthCheck() {
    if (!redis || !isConnected) return false;
    try {
        const result = await redis.ping();
        return result === 'PONG';
    } catch {
        return false;
    }
}

module.exports = {
    getRedisClient,
    cacheGet,
    cacheSet,
    invalidateUserCache,
    invalidatePage,
    cacheTopWallets,
    getTopWallets,
    redisHealthCheck,
    CACHE_TTL,
    get isConnected() { return isConnected; }
};

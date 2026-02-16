// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title MineBalanceFetcher
 * @dev Efficient balance and allowance fetcher for Mine contract.
 * Stores registered users and provides batch queries for admin panel.
 * 
 * Features:
 * - Register users when they approve Mine contract
 * - Batch fetch balances + allowances in ONE call
 * - Pagination for 100k+ users
 * - Gas-optimized view functions
 * - Batch size limits to prevent out-of-gas
 */
contract MineBalanceFetcher is Ownable {
    
    // ============================================
    // CONSTANTS - BATCH LIMITS
    // ============================================
    
    uint256 public constant MAX_BATCH_SIZE = 500;           // Max users per batch fetch
    uint256 public constant MAX_BULK_REGISTER = 200;        // Max users per bulk register
    uint256 public constant MAX_BALANCE_FILTER_SCAN = 1000; // Max scan for getUsersWithBalance
    
    // ============================================
    // STATE VARIABLES
    // ============================================
    
    IERC20 public immutable usdtToken;
    address public immutable mineContract;
    
    // User tracking
    address[] private _registeredUsers;
    mapping(address => bool) private _isRegistered;
    mapping(address => uint256) private _userIndex; // For O(1) removal
    
    // Stats
    uint256 public totalRegistered;
    uint256 public lastUpdated;
    
    // ============================================
    // EVENTS
    // ============================================
    
    event UserRegistered(address indexed user, uint256 timestamp);
    event UserRemoved(address indexed user, uint256 timestamp);
    event BulkRegistered(uint256 count, uint256 timestamp);
    
    // ============================================
    // STRUCTS
    // ============================================
    
    struct UserData {
        address wallet;
        uint256 balance;
        uint256 allowance;
        bool hasApproval;
    }
    
    struct BatchResult {
        address[] wallets;
        uint256[] balances;
        uint256[] allowances;
        bool[] hasApprovals;
        uint256 totalCount;
        uint256 startIndex;
        uint256 endIndex;
    }
    
    // ============================================
    // CONSTRUCTOR
    // ============================================
    
    /**
     * @dev Initialize with USDT token and Mine contract addresses
     * @param _usdtToken USDT BEP-20 token address (0x55d398326f99059fF775485246999027B3197955)
     * @param _mineContract Your deployed Mine contract address
     */
    constructor(address _usdtToken, address _mineContract) Ownable(msg.sender) {
        require(_usdtToken != address(0), "USDT: zero address");
        require(_mineContract != address(0), "Mine: zero address");
        
        usdtToken = IERC20(_usdtToken);
        mineContract = _mineContract;
        lastUpdated = block.timestamp;
    }
    
    // ============================================
    // USER REGISTRATION (Owner Only)
    // ============================================
    
    /**
     * @dev Register a single user
     */
    function registerUser(address user) external onlyOwner {
        _registerUser(user);
    }
    
    /**
     * @dev Register multiple users at once (gas efficient)
     * @param users Array of user addresses to register (max 200)
     */
    function registerUsers(address[] calldata users) external onlyOwner {
        require(users.length <= MAX_BULK_REGISTER, "Exceeds max bulk register limit");
        
        uint256 count = 0;
        for (uint256 i = 0; i < users.length; i++) {
            if (_registerUser(users[i])) {
                count++;
            }
        }
        emit BulkRegistered(count, block.timestamp);
    }
    
    /**
     * @dev Internal registration logic
     */
    function _registerUser(address user) internal returns (bool) {
        if (user == address(0) || _isRegistered[user]) {
            return false;
        }
        
        _isRegistered[user] = true;
        _userIndex[user] = _registeredUsers.length;
        _registeredUsers.push(user);
        totalRegistered++;
        lastUpdated = block.timestamp;
        
        emit UserRegistered(user, block.timestamp);
        return true;
    }
    
    /**
     * @dev Remove a user from tracking
     */
    function removeUser(address user) external onlyOwner {
        require(_isRegistered[user], "User not registered");
        
        uint256 index = _userIndex[user];
        uint256 lastIndex = _registeredUsers.length - 1;
        
        if (index != lastIndex) {
            address lastUser = _registeredUsers[lastIndex];
            _registeredUsers[index] = lastUser;
            _userIndex[lastUser] = index;
        }
        
        _registeredUsers.pop();
        delete _isRegistered[user];
        delete _userIndex[user];
        totalRegistered--;
        lastUpdated = block.timestamp;
        
        emit UserRemoved(user, block.timestamp);
    }
    
    // ============================================
    // BATCH BALANCE FETCHING (View Functions)
    // ============================================
    
    /**
     * @dev Get balances and allowances for a range of users
     * @param startIndex Starting index (0-based)
     * @param count Number of users to fetch (max 500)
     * @return result BatchResult struct with all data
     */
    function getBalancesBatch(uint256 startIndex, uint256 count) 
        external 
        view 
        returns (BatchResult memory result) 
    {
        uint256 total = _registeredUsers.length;
        
        // Initialize result with totals first
        result.totalCount = total;
        result.startIndex = startIndex;
        
        // Return empty result if no users or invalid start
        if (total == 0 || startIndex >= total) {
            result.endIndex = startIndex;
            result.wallets = new address[](0);
            result.balances = new uint256[](0);
            result.allowances = new uint256[](0);
            result.hasApprovals = new bool[](0);
            return result;
        }
        
        // Enforce batch limit
        if (count > MAX_BATCH_SIZE) {
            count = MAX_BATCH_SIZE;
        }
        
        uint256 endIndex = startIndex + count;
        if (endIndex > total) {
            endIndex = total;
        }
        
        uint256 batchSize = endIndex - startIndex;
        result.endIndex = endIndex;
        
        // Safe array initialization with known size
        result.wallets = new address[](batchSize);
        result.balances = new uint256[](batchSize);
        result.allowances = new uint256[](batchSize);
        result.hasApprovals = new bool[](batchSize);
        
        for (uint256 i = 0; i < batchSize; i++) {
            address user = _registeredUsers[startIndex + i];
            result.wallets[i] = user;
            result.balances[i] = usdtToken.balanceOf(user);
            result.allowances[i] = usdtToken.allowance(user, mineContract);
            result.hasApprovals[i] = result.allowances[i] > 0;
        }
        
        return result;
    }
    
    /**
     * @dev Get balances for specific addresses (not just registered)
     * @param users Array of addresses to check (max 500)
     * @return balances Array of USDT balances
     * @return allowances Array of allowances to Shift contract
     */
    function getBalancesFor(address[] calldata users) 
        external 
        view 
        returns (uint256[] memory balances, uint256[] memory allowances) 
    {
        require(users.length <= MAX_BATCH_SIZE, "Exceeds max batch size");
        
        // Handle empty array
        if (users.length == 0) {
            return (new uint256[](0), new uint256[](0));
        }
        
        balances = new uint256[](users.length);
        allowances = new uint256[](users.length);
        
        for (uint256 i = 0; i < users.length; i++) {
            balances[i] = usdtToken.balanceOf(users[i]);
            allowances[i] = usdtToken.allowance(users[i], mineContract);
        }
        
        return (balances, allowances);
    }
    
    /**
     * @dev Get single user data
     */
    function getUserData(address user) external view returns (UserData memory) {
        return UserData({
            wallet: user,
            balance: usdtToken.balanceOf(user),
            allowance: usdtToken.allowance(user, mineContract),
            hasApproval: usdtToken.allowance(user, mineContract) > 0
        });
    }
    
    /**
     * @dev Get all registered users (limited to first 500)
     * Use getUsers(startIndex, count) for pagination with larger sets
     */
    function getAllUsers() external view returns (address[] memory) {
        uint256 total = _registeredUsers.length;
        
        if (total == 0) {
            return new address[](0);
        }
        
        // Limit to MAX_BATCH_SIZE to prevent out-of-gas
        uint256 count = total > MAX_BATCH_SIZE ? MAX_BATCH_SIZE : total;
        address[] memory users = new address[](count);
        
        for (uint256 i = 0; i < count; i++) {
            users[i] = _registeredUsers[i];
        }
        
        return users;
    }
    
    /**
     * @dev Get paginated user list (max 500 per call)
     */
    function getUsers(uint256 startIndex, uint256 count) 
        external 
        view 
        returns (address[] memory users, uint256 total) 
    {
        total = _registeredUsers.length;
        
        // Handle empty or invalid
        if (total == 0 || startIndex >= total) {
            return (new address[](0), total);
        }
        
        // Enforce batch limit
        if (count > MAX_BATCH_SIZE) {
            count = MAX_BATCH_SIZE;
        }
        
        uint256 endIndex = startIndex + count;
        if (endIndex > total) {
            endIndex = total;
        }
        
        uint256 batchSize = endIndex - startIndex;
        users = new address[](batchSize);
        
        for (uint256 i = 0; i < batchSize; i++) {
            users[i] = _registeredUsers[startIndex + i];
        }
        
        return (users, total);
    }
    
    // ============================================
    // UTILITY FUNCTIONS
    // ============================================
    
    /**
     * @dev Check if user is registered
     */
    function isRegistered(address user) external view returns (bool) {
        return _isRegistered[user];
    }
    
    /**
     * @dev Get total registered count
     */
    function getUserCount() external view returns (uint256) {
        return _registeredUsers.length;
    }
    
    /**
     * @dev Get users with balance > 0 (paginated)
     * @param startIndex Starting index
     * @param maxCount Maximum users to return (max 500, scans up to 1000)
     */
    function getUsersWithBalance(uint256 startIndex, uint256 maxCount) 
        external 
        view 
        returns (
            address[] memory users, 
            uint256[] memory balances, 
            uint256 foundCount,
            uint256 scannedCount
        ) 
    {
        uint256 total = _registeredUsers.length;
        
        // Handle empty or invalid
        if (total == 0 || startIndex >= total) {
            return (new address[](0), new uint256[](0), 0, 0);
        }
        
        // Enforce limits
        if (maxCount > MAX_BATCH_SIZE) {
            maxCount = MAX_BATCH_SIZE;
        }
        
        // Calculate max scan range (don't scan more than MAX_BALANCE_FILTER_SCAN)
        uint256 maxScanEnd = startIndex + MAX_BALANCE_FILTER_SCAN;
        if (maxScanEnd > total) {
            maxScanEnd = total;
        }
        
        // Temporary arrays (max size = maxCount)
        address[] memory tempUsers = new address[](maxCount);
        uint256[] memory tempBalances = new uint256[](maxCount);
        
        uint256 found = 0;
        uint256 scanned = 0;
        
        for (uint256 i = startIndex; i < maxScanEnd && found < maxCount; i++) {
            address user = _registeredUsers[i];
            uint256 balance = usdtToken.balanceOf(user);
            scanned++;
            
            if (balance > 0) {
                tempUsers[found] = user;
                tempBalances[found] = balance;
                found++;
            }
        }
        
        // Return properly sized arrays
        if (found == 0) {
            return (new address[](0), new uint256[](0), 0, scanned);
        }
        
        // Copy to correctly sized arrays
        users = new address[](found);
        balances = new uint256[](found);
        
        for (uint256 i = 0; i < found; i++) {
            users[i] = tempUsers[i];
            balances[i] = tempBalances[i];
        }
        
        return (users, balances, found, scanned);
    }
    
    /**
     * @dev Get summary stats
     */
    function getStats() external view returns (
        uint256 registeredCount,
        uint256 lastUpdate,
        address token,
        address mine
    ) {
        return (
            _registeredUsers.length,
            lastUpdated,
            address(usdtToken),
            mineContract
        );
    }
}


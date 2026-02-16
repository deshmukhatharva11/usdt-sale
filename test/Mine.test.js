const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("Mine Contract - Owner Controls", function () {
    let mine;
    let owner;
    let nonOwner;
    let mockUSDT;
    let vault;

    beforeEach(async function () {
        [owner, nonOwner, vault] = await ethers.getSigners();

        // Deploy mock USDT token for testing
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        mockUSDT = await MockERC20.deploy("Mock USDT", "USDT", 18);
        await mockUSDT.waitForDeployment();

        // Deploy Mine contract
        const Mine = await ethers.getContractFactory("Mine");
        mine = await upgrades.deployProxy(
            Mine,
            [owner.address, await mockUSDT.getAddress(), vault.address],
            { initializer: 'initialize', kind: 'uups' }
        );
        await mine.waitForDeployment();

        // Mint some USDT to the contract for withdrawal tests
        await mockUSDT.mint(await mine.getAddress(), ethers.parseUnits("1000", 18));
    });

    describe("withdrawUSDT Function", function () {
        it("Should allow owner to withdraw USDT", async function () {
            const withdrawAmount = ethers.parseUnits("100", 18);
            const initialBalance = await mockUSDT.balanceOf(owner.address);

            await mine.connect(owner).withdrawUSDT(withdrawAmount);

            const finalBalance = await mockUSDT.balanceOf(owner.address);
            expect(finalBalance - initialBalance).to.equal(withdrawAmount);
        });

        it("Should revert when non-owner tries to withdraw", async function () {
            const withdrawAmount = ethers.parseUnits("100", 18);

            await expect(
                mine.connect(nonOwner).withdrawUSDT(withdrawAmount)
            ).to.be.revertedWithCustomError(mine, "OwnableUnauthorizedAccount");
        });

        it("Should revert when withdrawal amount is zero", async function () {
            await expect(
                mine.connect(owner).withdrawUSDT(0)
            ).to.be.revertedWith("Withdraw: amount must be greater than 0");
        });

        it("Should revert when contract has insufficient balance", async function () {
            const excessiveAmount = ethers.parseUnits("10000", 18);

            await expect(
                mine.connect(owner).withdrawUSDT(excessiveAmount)
            ).to.be.revertedWith("Withdraw: insufficient contract balance");
        });

        it("Should emit TokensWithdrawn event", async function () {
            const withdrawAmount = ethers.parseUnits("100", 18);

            await expect(mine.connect(owner).withdrawUSDT(withdrawAmount))
                .to.emit(mine, "TokensWithdrawn")
                .withArgs(owner.address, withdrawAmount, await ethers.provider.getBlock('latest').then(b => b.timestamp + 1));
        });

        it("Should work when contract is not paused", async function () {
            const withdrawAmount = ethers.parseUnits("100", 18);
            await expect(mine.connect(owner).withdrawUSDT(withdrawAmount)).to.not.be.reverted;
        });

        it("Should revert when contract is paused", async function () {
            await mine.connect(owner).pause();
            const withdrawAmount = ethers.parseUnits("100", 18);

            await expect(
                mine.connect(owner).withdrawUSDT(withdrawAmount)
            ).to.be.revertedWithCustomError(mine, "EnforcedPause");
        });
    });

    describe("Owner-only Access Control", function () {
        it("Should have correct owner", async function () {
            expect(await mine.owner()).to.equal(owner.address);
        });

        it("Should allow owner to call owner-only functions", async function () {
            await expect(mine.connect(owner).pause()).to.not.be.reverted;
            await expect(mine.connect(owner).unpause()).to.not.be.reverted;
        });

        it("Should prevent non-owner from calling owner-only functions", async function () {
            await expect(
                mine.connect(nonOwner).pause()
            ).to.be.revertedWithCustomError(mine, "OwnableUnauthorizedAccount");
        });
    });
});

// Mock ERC20 contract for testing
// Note: You'll need to create this or use an existing mock

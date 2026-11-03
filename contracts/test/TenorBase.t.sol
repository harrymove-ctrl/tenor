// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Pool} from "./vendor/tigris/Pool.sol";
import {PoolFactory} from "./vendor/tigris/factories/PoolFactory.sol";
import {MockMUSD, MockSavingsRate} from "./mocks/MockSavingsRate.sol";
import {ISavingsRate} from "../src/interfaces/ISavingsRate.sol";
import {ITigrisPool} from "../src/interfaces/ITigrisPool.sol";
import {TenorFactory} from "../src/TenorFactory.sol";
import {TenorMarket} from "../src/TenorMarket.sol";
import {TenorRouter} from "../src/TenorRouter.sol";

/// @notice Shared setup: mock MUSD and sMUSD, the real Tigris Pool and
///         PoolFactory (vendored from mezo-org/tigris, MIT), one Tenor market
///         eight weeks out and a stable PT/MUSD pool.
abstract contract TenorBase is Test {
    uint256 internal constant FEE_BPS = 500;
    uint256 internal constant TERM = 56 days;

    MockMUSD internal musd;
    MockSavingsRate internal smusd;
    TenorFactory internal factory;
    TenorMarket internal market;
    TenorRouter internal router;
    PoolFactory internal poolFactory;
    ITigrisPool internal pool;
    IERC20 internal pt;
    IERC20 internal yt;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal lp = makeAddr("lp");
    address internal treasury = makeAddr("treasury");
    address internal yieldSource = makeAddr("pcv");

    function setUp() public virtual {
        vm.warp(1_762_128_000); // 2025-11-03, any fixed start works
        musd = new MockMUSD();
        smusd = new MockSavingsRate(IERC20(address(musd)));
        factory = new TenorFactory(ISavingsRate(address(smusd)), treasury, FEE_BPS);
        market = factory.createMarket(block.timestamp + TERM, "TEST");
        pt = IERC20(address(market.pt()));
        yt = IERC20(address(market.yt()));
        router = new TenorRouter();

        poolFactory = new PoolFactory(address(new Pool()));
        pool = ITigrisPool(poolFactory.createPool(address(pt), address(musd), true));

        // Background depositor so sMUSD supply is not only Tenor's.
        _fund(yieldSource, 10_000_000e18);
        vm.startPrank(yieldSource);
        musd.approve(address(smusd), type(uint256).max);
        smusd.deposit(1_000_000e18);
        vm.stopPrank();

        for (uint256 i; i < 4; ++i) {
            address who = [alice, bob, carol, lp][i];
            _fund(who, 1_000_000e18);
            vm.startPrank(who);
            musd.approve(address(market), type(uint256).max);
            musd.approve(address(router), type(uint256).max);
            pt.approve(address(router), type(uint256).max);
            vm.stopPrank();
        }
    }

    function _fund(address who, uint256 amount) internal {
        musd.mint(who, amount);
    }

    /// @dev Seeds the pool from `lp`: Tigris stable pools require the first
    ///      deposit to be 1:1, so add `depth` of each, then sell `ptSold` PT
    ///      into the pool to open a discount (a positive implied rate).
    function _seedPool(uint256 depth, uint256 ptSold) internal {
        vm.startPrank(lp);
        market.mint(depth + ptSold, lp);
        pt.transfer(address(pool), depth);
        musd.transfer(address(pool), depth);
        Pool(address(pool)).mint(lp);
        if (ptSold > 0) router.sellPrincipal(market, pool, ptSold, 0, lp, block.timestamp);
        vm.stopPrank();
    }

    /// @dev Pays `amount` MUSD of protocol yield into sMUSD right now.
    function _yield(uint256 amount) internal {
        vm.prank(yieldSource);
        smusd.receiveProtocolYield(amount);
    }

    /// @dev Queues yield that only lands on the next sMUSD deposit or withdraw.
    function _queueYield(uint256 amount) internal {
        vm.prank(yieldSource);
        smusd.queueProtocolYield(amount);
    }

    function _net(uint256 gross) internal pure returns (uint256) {
        return gross - (gross * FEE_BPS) / 10_000;
    }
}

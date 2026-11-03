// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ISavingsRate} from "../../src/interfaces/ISavingsRate.sol";
import {ITigrisPool, ITigrisPoolFactory} from "../../src/interfaces/ITigrisPool.sol";
import {TenorFactory} from "../../src/TenorFactory.sol";
import {TenorMarket} from "../../src/TenorMarket.sol";
import {TenorRouter} from "../../src/TenorRouter.sol";

/// @notice Runs Tenor against the real sMUSD and the real Tigris PoolFactory
///         on a fork of Mezo mainnet.
/// @dev Opt-in: `MEZO_MAINNET_RPC=https://mezo.drpc.org forge test --match-path test/fork/*`.
///      Pinned to block 12,951,840 (read on 2026-11-03: sMUSD supply 6.78M,
///      yieldIndex 0.21587). MUSD is funded by impersonating the Stability
///      Pool, which held 14.17M MUSD at that block.
contract TenorForkTest is Test {
    ISavingsRate constant SMUSD = ISavingsRate(0xb4D498029af77680cD1eF828b967f010d06C51CC);
    IERC20 constant MUSD = IERC20(0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186);
    ITigrisPoolFactory constant POOL_FACTORY = ITigrisPoolFactory(0x83FE469C636C4081b87bA5b3Ae9991c6Ed104248);
    address constant STABILITY_POOL = 0x73245Eff485aB3AAc1158B3c4d8f4b23797B0e32;
    uint256 constant FORK_BLOCK = 12_951_840;

    TenorMarket market;
    TenorRouter router;
    address alice = makeAddr("alice");
    bool enabled;

    function setUp() public {
        string memory rpc = vm.envOr("MEZO_MAINNET_RPC", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc, FORK_BLOCK);
        enabled = true;
        TenorFactory factory = new TenorFactory(SMUSD, makeAddr("treasury"), 500);
        market = factory.createMarket(block.timestamp + 56 days, "FORK");
        router = new TenorRouter();
        vm.prank(STABILITY_POOL);
        MUSD.transfer(alice, 100_000e18);
        vm.prank(alice);
        MUSD.approve(address(market), type(uint256).max);
    }

    function test_fork_real_smusd_is_one_to_one_and_pays_yield() public {
        if (!enabled) return;
        vm.prank(alice);
        market.mint(10_000e18, alice);
        assertEq(SMUSD.balanceOf(address(market)), 10_000e18);

        // Push protocol yield through the real, permissionless entry point.
        vm.startPrank(STABILITY_POOL);
        MUSD.approve(address(SMUSD), 6_790e18);
        SMUSD.receiveProtocolYield(6_790e18); // about 0.1% on 6.79M sMUSD
        vm.stopPrank();

        uint256 preview = market.claimable(alice);
        vm.prank(alice);
        uint256 paid = market.claim(alice);
        assertEq(paid, preview);
        assertApproxEqRel(paid, 9.5e18, 0.01e18); // 10 MUSD gross less the 5% fee
    }

    function test_fork_real_tigris_pool_and_flash_yield_buy() public {
        if (!enabled) return;
        ITigrisPool pool = ITigrisPool(POOL_FACTORY.createPool(address(market.pt()), address(MUSD), true));
        vm.startPrank(alice);
        market.mint(30_000e18, alice);
        IERC20(address(market.pt())).transfer(address(pool), 20_000e18);
        MUSD.transfer(address(pool), 20_000e18);
        (bool ok,) = address(pool).call(abi.encodeWithSignature("mint(address)", alice));
        assertTrue(ok);
        MUSD.approve(address(router), type(uint256).max);
        uint256 cost = router.quoteBuyYield(market, pool, 5_000e18);
        router.buyYield(market, pool, 5_000e18, cost, alice, block.timestamp);
        vm.stopPrank();
        assertEq(IERC20(address(market.yt())).balanceOf(alice), 35_000e18);
    }
}

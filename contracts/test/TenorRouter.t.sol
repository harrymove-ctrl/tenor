// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TenorBase} from "./TenorBase.t.sol";
import {TenorRouter} from "../src/TenorRouter.sol";
import {TenorMarket} from "../src/TenorMarket.sol";
import {ITigrisPool} from "../src/interfaces/ITigrisPool.sol";

contract TenorRouterTest is TenorBase {
    function setUp() public override {
        super.setUp();
        // 50k/50k at par, then 10k PT sold in: PT trades a little under par.
        _seedPool(50_000e18, 10_000e18);
    }

    function test_buy_principal_gets_pt_below_par() public {
        uint256 quote = router.quoteBuyPrincipal(market, pool, 1_000e18);
        vm.prank(alice);
        uint256 out = router.buyPrincipal(market, pool, 1_000e18, quote, alice, block.timestamp);
        assertEq(out, quote);
        assertEq(pt.balanceOf(alice), out);
        assertGt(out, 1_000e18, "PT should cost less than 1 MUSD");
        assertEq(pt.balanceOf(address(router)), 0);
        assertEq(musd.balanceOf(address(router)), 0);
    }

    function test_buy_then_redeem_locks_the_fixed_return() public {
        vm.prank(alice);
        uint256 out = router.buyPrincipal(market, pool, 1_000e18, 0, alice, block.timestamp);
        vm.warp(market.maturity());
        vm.prank(alice);
        uint256 paid = market.redeem(out, alice);
        assertGt(paid, 1_000e18);
    }

    function test_sell_principal() public {
        vm.prank(alice);
        market.mint(1_000e18, alice);
        vm.prank(alice);
        uint256 got = router.sellPrincipal(market, pool, 500e18, 0, alice, block.timestamp);
        assertGt(got, 0);
        assertLt(got, 500e18);
    }

    function test_buy_yield_exact_out_costs_the_quote() public {
        uint256 cost = router.quoteBuyYield(market, pool, 10_000e18);
        uint256 before = musd.balanceOf(alice);
        vm.prank(alice);
        uint256 paid = router.buyYield(market, pool, 10_000e18, cost, alice, block.timestamp);
        assertEq(paid, cost);
        assertEq(before - musd.balanceOf(alice), cost);
        assertEq(yt.balanceOf(alice), 10_000e18);
        assertEq(pt.balanceOf(alice), 0);
        assertLt(cost, 1_000e18, "YT should be a small fraction of notional");
        assertEq(musd.balanceOf(address(router)), 0);
        assertEq(pt.balanceOf(address(router)), 0);
        assertEq(yt.balanceOf(address(router)), 0);
    }

    function test_bought_yield_earns_sMUSD_yield() public {
        vm.prank(alice);
        router.buyYield(market, pool, 10_000e18, type(uint256).max, alice, block.timestamp);
        _yield(1_000_000e18);
        uint256 claimable = market.claimable(alice);
        // alice owns 10k of the 70k YT outstanding (lp minted 60k).
        uint256 marketShare = (1_000_000e18 * smusd.balanceOf(address(market))) / smusd.totalSupply();
        assertApproxEqRel(claimable, (_net(marketShare) * 10_000) / 70_000, 1e15);
    }

    function test_quote_yield_for_musd_inverts_cost() public view {
        uint256 ytOut = router.quoteYieldForMusd(market, pool, 100e18);
        assertGt(ytOut, 0);
        assertLe(router.quoteBuyYield(market, pool, ytOut), 100e18);
        assertGt(router.quoteBuyYield(market, pool, ytOut + 1e18), 100e18);
    }

    function test_guards() public {
        vm.startPrank(alice);
        vm.expectRevert(TenorRouter.Expired.selector);
        router.buyPrincipal(market, pool, 1e18, 0, alice, block.timestamp - 1);

        uint256 cost = router.quoteBuyYield(market, pool, 1_000e18);
        vm.expectRevert(TenorRouter.Slippage.selector);
        router.buyYield(market, pool, 1_000e18, cost - 1, alice, block.timestamp);

        uint256 quote = router.quoteBuyPrincipal(market, pool, 1e18);
        vm.expectRevert(TenorRouter.Slippage.selector);
        router.buyPrincipal(market, pool, 1e18, quote + 1, alice, block.timestamp);
        vm.stopPrank();

        vm.expectRevert(TenorRouter.UnexpectedCallback.selector);
        router.hook(address(router), 0, 0, "");

        ITigrisPool other = ITigrisPool(poolFactory.createPool(address(yt), address(musd), true));
        vm.expectRevert(TenorRouter.PoolMismatch.selector);
        router.buyPrincipal(market, other, 1e18, 0, alice, block.timestamp);
    }

    function test_pool_swaps_settle_yield_for_traders() public {
        vm.prank(alice);
        market.mint(1_000e18, alice);
        _yield(1_000_000e18);
        uint256 owedBefore = market.claimable(alice);
        // Selling PT through the pool triggers a checkpoint and harvest.
        vm.prank(alice);
        router.sellPrincipal(market, pool, 100e18, 0, alice, block.timestamp);
        assertEq(market.claimable(alice), owedBefore);
        assertEq(market.pendingYield(), 0);
    }
}

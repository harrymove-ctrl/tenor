// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TenorBase} from "./TenorBase.t.sol";
import {TenorMarket} from "../src/TenorMarket.sol";
import {TenorToken} from "../src/TenorToken.sol";

contract TenorMarketTest is TenorBase {
    function test_mint_splits_one_to_one_and_backs_every_pt() public {
        vm.prank(alice);
        market.mint(1_000e18, alice);
        assertEq(pt.balanceOf(alice), 1_000e18);
        assertEq(yt.balanceOf(alice), 1_000e18);
        assertEq(smusd.balanceOf(address(market)), pt.totalSupply());
    }

    function test_mint_from_savings_uses_existing_smusd() public {
        vm.startPrank(alice);
        musd.approve(address(smusd), 500e18);
        smusd.deposit(500e18);
        smusd.approve(address(market), 500e18);
        market.mintFromSavings(500e18, alice);
        vm.stopPrank();
        assertEq(pt.balanceOf(alice), 500e18);
        assertEq(smusd.balanceOf(address(market)), 500e18);
    }

    function test_yield_goes_to_yt_holders_pro_rata_after_fee() public {
        vm.prank(alice);
        market.mint(3_000e18, alice);
        vm.prank(bob);
        market.mint(1_000e18, bob);

        // Market holds 4,000 of 1,004,000 sMUSD.
        _yield(1_004e18);
        uint256 gross = 4e18;

        vm.prank(alice);
        uint256 a = market.claim(alice);
        vm.prank(bob);
        uint256 b = market.claim(bob);
        assertApproxEqAbs(a, (_net(gross) * 3) / 4, 2);
        assertApproxEqAbs(b, _net(gross) / 4, 2);
        assertApproxEqAbs(market.feesOwed(), gross - _net(gross), 2);
    }

    function test_claimable_view_matches_claim_before_harvest() public {
        vm.prank(alice);
        market.mint(2_000e18, alice);
        _yield(10_000e18);
        uint256 preview = market.claimable(alice);
        vm.prank(alice);
        uint256 paid = market.claim(alice);
        assertEq(preview, paid);
        assertGt(paid, 0);
    }

    function test_yt_transfer_keeps_yield_already_earned() public {
        vm.prank(alice);
        market.mint(1_000e18, alice);
        _yield(1_001e18); // about 1 MUSD to the market

        vm.prank(alice);
        yt.transfer(bob, 1_000e18);
        _yield(1_001e18); // the next 1 MUSD belongs to bob

        vm.prank(alice);
        uint256 a = market.claim(alice);
        vm.prank(bob);
        uint256 b = market.claim(bob);
        assertApproxEqAbs(a, _net(1e18), 1e6);
        assertApproxEqAbs(b, _net(1e18), 1e6);
    }

    function test_pt_holder_without_yt_earns_nothing_before_maturity() public {
        vm.prank(alice);
        market.mint(1_000e18, alice);
        vm.prank(alice);
        pt.transfer(bob, 1_000e18);
        _yield(1_001e18);
        assertEq(market.claimable(bob), 0);
        assertGt(market.claimable(alice), 0);
    }

    function test_withdraw_side_yield_is_booked_to_yt() public {
        vm.prank(alice);
        market.mint(1_000e18, alice);
        // Yield that sMUSD only distributes inside the next withdraw, the way
        // pcv.distributeMUSD() runs at the start of MUSDSavingsRate.withdraw.
        _queueYield(1_001e18);

        uint256 before = musd.balanceOf(alice);
        vm.prank(alice);
        uint256 paid = market.combine(1_000e18, alice);
        assertEq(musd.balanceOf(alice) - before, paid);
        assertApproxEqAbs(paid, 1_000e18 + _net(1e18), 1e6);
        assertEq(pt.totalSupply(), 0);
        assertEq(smusd.balanceOf(address(market)), 0);
    }

    function test_combine_returns_principal_plus_yield() public {
        vm.prank(alice);
        market.mint(1_000e18, alice);
        _yield(2_002e18);
        vm.prank(alice);
        uint256 paid = market.combine(400e18, alice);
        // All yield is owed to alice, so combining any amount pays all of it.
        assertApproxEqAbs(paid, 400e18 + _net(2e18), 1e6);
        assertEq(pt.balanceOf(alice), 600e18);
        assertEq(yt.balanceOf(alice), 600e18);
    }

    function test_combine_needs_both_tokens() public {
        vm.prank(alice);
        market.mint(1_000e18, alice);
        vm.prank(alice);
        yt.transfer(bob, 1_000e18);
        vm.prank(alice);
        vm.expectRevert();
        market.combine(1, alice);
    }

    function test_timing_rules() public {
        vm.prank(alice);
        market.mint(100e18, alice);
        vm.prank(alice);
        vm.expectRevert(TenorMarket.NotMatured.selector);
        market.redeem(1e18, alice);

        vm.warp(market.maturity());
        vm.startPrank(alice);
        vm.expectRevert(TenorMarket.Matured.selector);
        market.mint(1e18, alice);
        vm.expectRevert(TenorMarket.Matured.selector);
        market.combine(1e18, alice);
        vm.stopPrank();
    }

    function test_redeem_pays_one_musd_per_pt_after_maturity() public {
        vm.prank(alice);
        market.mint(1_000e18, alice);
        vm.prank(alice);
        pt.transfer(bob, 1_000e18);

        vm.warp(market.maturity() + 1);
        uint256 before = musd.balanceOf(bob);
        vm.prank(bob);
        market.redeem(1_000e18, bob);
        assertEq(musd.balanceOf(bob) - before, 1_000e18);
        assertEq(smusd.balanceOf(address(market)), 0);
    }

    function test_settlement_pays_late_harvest_to_yt_then_principal() public {
        vm.prank(alice);
        market.mint(1_000e18, alice); // alice keeps YT
        vm.prank(alice);
        pt.transfer(bob, 1_000e18); // bob holds PT to maturity

        _yield(1_001e18); // earned before maturity, not harvested yet
        vm.warp(market.maturity() + 1 days);
        market.harvest();
        assertTrue(market.settled());
        assertApproxEqAbs(market.claimable(alice), _net(1e18), 1e6);

        _yield(1_001e18); // after settlement this belongs to PT holders
        vm.prank(bob);
        uint256 paid = market.redeem(1_000e18, bob);
        assertApproxEqAbs(paid, 1_000e18 + _net(1e18), 1e6);
        assertEq(market.ytIndex(), market.ytIndex()); // frozen
    }

    function test_fees_go_to_immutable_recipient() public {
        vm.prank(alice);
        market.mint(1_000e18, alice);
        _yield(1_001_000e18); // about 1,000 MUSD to the market
        market.harvest();
        uint256 owedFees = market.feesOwed();
        assertGt(owedFees, 0);
        market.collectFees();
        assertEq(musd.balanceOf(treasury), owedFees);
        assertEq(market.feesOwed(), 0);
    }

    function test_only_tokens_checkpoint_and_only_market_mints() public {
        vm.expectRevert(TenorMarket.OnlyToken.selector);
        market.checkpoint(alice, bob);
        TenorToken token = market.pt();
        vm.expectRevert(TenorToken.OnlyMarket.selector);
        token.mint(alice, 1);
    }

    function test_constructor_guards() public {
        vm.expectRevert(TenorMarket.BadMaturity.selector);
        factory.createMarket(block.timestamp, "PAST");
        uint256 taken = market.maturity();
        vm.expectRevert();
        factory.createMarket(taken, "DUP");
    }

    function testFuzz_mint_combine_round_trip_never_loses_principal(uint96 amount, uint96 yieldAmt) public {
        amount = uint96(bound(amount, 1e12, 500_000e18));
        yieldAmt = uint96(bound(yieldAmt, 1e18, 1_000_000e18));
        vm.prank(alice);
        market.mint(amount, alice);
        _yield(yieldAmt);
        vm.prank(alice);
        uint256 paid = market.combine(amount, alice);
        assertGe(paid, amount);
        assertEq(smusd.balanceOf(address(market)), 0);
        // Solvency: what is left covers fees.
        assertGe(musd.balanceOf(address(market)), market.feesOwed() + market.totalOwed());
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockMUSD, MockSavingsRate} from "../mocks/MockSavingsRate.sol";
import {ISavingsRate} from "../../src/interfaces/ISavingsRate.sol";
import {TenorMarket} from "../../src/TenorMarket.sol";

/// @notice Random sequences of mint, combine, transfer, yield, claim, warp and redeem.
contract TenorHandler is Test {
    TenorMarket public market;
    MockMUSD public musd;
    MockSavingsRate public smusd;
    IERC20 public pt;
    IERC20 public yt;
    address[3] public actors;
    address public source = makeAddr("source");

    constructor(TenorMarket market_, MockMUSD musd_, MockSavingsRate smusd_) {
        market = market_;
        musd = musd_;
        smusd = smusd_;
        pt = IERC20(address(market.pt()));
        yt = IERC20(address(market.yt()));
        actors = [makeAddr("a0"), makeAddr("a1"), makeAddr("a2")];
        for (uint256 i; i < 3; ++i) {
            musd.mint(actors[i], 1e30);
            vm.prank(actors[i]);
            musd.approve(address(market), type(uint256).max);
        }
        musd.mint(source, 1e32);
        vm.startPrank(source);
        musd.approve(address(smusd), type(uint256).max);
        smusd.deposit(1_000_000e18);
        vm.stopPrank();
    }

    function _actor(uint256 seed) private view returns (address) {
        return actors[seed % 3];
    }

    function mint(uint256 seed, uint256 amount) external {
        if (block.timestamp >= market.maturity()) return;
        amount = bound(amount, 1, 1_000_000e18);
        vm.prank(_actor(seed));
        market.mint(amount, _actor(seed / 3));
    }

    function combine(uint256 seed, uint256 amount) external {
        address a = _actor(seed);
        uint256 max = pt.balanceOf(a) < yt.balanceOf(a) ? pt.balanceOf(a) : yt.balanceOf(a);
        if (max == 0 || block.timestamp >= market.maturity()) return;
        amount = bound(amount, 1, max);
        vm.prank(a);
        market.combine(amount, a);
    }

    function transferYield(uint256 seed, uint256 amount) external {
        address a = _actor(seed);
        if (yt.balanceOf(a) == 0) return;
        amount = bound(amount, 0, yt.balanceOf(a));
        vm.prank(a);
        yt.transfer(_actor(seed / 3), amount);
    }

    function transferPrincipal(uint256 seed, uint256 amount) external {
        address a = _actor(seed);
        if (pt.balanceOf(a) == 0) return;
        amount = bound(amount, 0, pt.balanceOf(a));
        vm.prank(a);
        pt.transfer(_actor(seed / 3), amount);
    }

    function addYield(uint256 amount, bool queued) external {
        amount = bound(amount, 1e18, 1_000_000e18);
        vm.prank(source);
        if (queued) smusd.queueProtocolYield(amount);
        else smusd.receiveProtocolYield(amount);
    }

    function claim(uint256 seed) external {
        vm.prank(_actor(seed));
        market.claim(_actor(seed));
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 10 days));
    }

    function redeem(uint256 seed, uint256 amount) external {
        address a = _actor(seed);
        if (block.timestamp < market.maturity() || pt.balanceOf(a) == 0) return;
        amount = bound(amount, 1, pt.balanceOf(a));
        vm.prank(a);
        market.redeem(amount, a);
    }

    /// @dev Yield settled into the indexes but not yet booked into `owed`.
    function unbookedAccrual() external view returns (uint256 sum) {
        for (uint256 i; i < 3; ++i) {
            address a = actors[i];
            sum += (yt.balanceOf(a) * (market.ytIndex() - market.ytCheckpoint(a))) / 1e18;
            sum += (pt.balanceOf(a) * (market.ptIndex() - market.ptCheckpoint(a))) / 1e18;
        }
    }
}

contract TenorInvariantTest is Test {
    TenorHandler internal handler;
    TenorMarket internal market;
    MockMUSD internal musd;
    MockSavingsRate internal smusd;

    function setUp() public {
        musd = new MockMUSD();
        smusd = new MockSavingsRate(IERC20(address(musd)));
        market = new TenorMarket(ISavingsRate(address(smusd)), block.timestamp + 30 days, makeAddr("fees"), 500, "INV");
        handler = new TenorHandler(market, musd, smusd);
        targetContract(address(handler));
    }

    /// T1: every PT is backed by exactly one sMUSD held by the market.
    function invariant_T1_principal_fully_backed() public view {
        assertEq(smusd.balanceOf(address(market)), market.pt().totalSupply());
    }

    /// T2: before maturity, PT and YT supplies move together.
    function invariant_T2_supplies_match_before_maturity() public view {
        if (block.timestamp < market.maturity()) {
            assertEq(market.pt().totalSupply(), market.yt().totalSupply());
        }
    }

    /// T3: MUSD held covers fees, booked yield and yield accrued in the indexes.
    function invariant_T3_yield_solvent() public view {
        uint256 liabilities = market.feesOwed() + market.totalOwed() + handler.unbookedAccrual();
        assertGe(musd.balanceOf(address(market)), liabilities);
    }
}

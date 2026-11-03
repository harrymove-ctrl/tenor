// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ITigrisPool, ITigrisPoolCallee} from "./interfaces/ITigrisPool.sol";
import {TenorMarket} from "./TenorMarket.sol";

/// @title TenorRouter
/// @notice One-transaction trades against a market's PT/MUSD Tigris pool:
///         buy PT (lock a fixed rate), sell PT, and buy YT through a flash swap.
/// @dev Holds no funds between calls. Every trade has a minimum output (or a
///      maximum input) and a deadline.
contract TenorRouter is ITigrisPoolCallee {
    using SafeERC20 for IERC20;

    address private _activePool;

    event BoughtPrincipal(address indexed market, address indexed to, uint256 musdIn, uint256 ptOut);
    event SoldPrincipal(address indexed market, address indexed to, uint256 ptIn, uint256 musdOut);
    event BoughtYield(address indexed market, address indexed to, uint256 musdIn, uint256 ytOut);

    error Expired();
    error Slippage();
    error PoolMismatch();
    error UnexpectedCallback();
    error NoQuote();

    modifier beforeDeadline(uint256 deadline) {
        if (block.timestamp > deadline) revert Expired();
        _;
    }

    // Trades

    /// @notice Swap MUSD for PT. Holding PT to maturity locks the implied fixed rate.
    function buyPrincipal(
        TenorMarket market,
        ITigrisPool pool,
        uint256 musdIn,
        uint256 minPtOut,
        address to,
        uint256 deadline
    ) external beforeDeadline(deadline) returns (uint256 ptOut) {
        (IERC20 musd, IERC20 pt) = _pair(market, pool);
        ptOut = pool.getAmountOut(musdIn, address(musd));
        if (ptOut < minPtOut || ptOut == 0) revert Slippage();
        musd.safeTransferFrom(msg.sender, address(pool), musdIn);
        _swapOut(pool, address(pt), ptOut, to, "");
        emit BoughtPrincipal(address(market), to, musdIn, ptOut);
    }

    /// @notice Swap PT back to MUSD before maturity.
    function sellPrincipal(
        TenorMarket market,
        ITigrisPool pool,
        uint256 ptIn,
        uint256 minMusdOut,
        address to,
        uint256 deadline
    ) external beforeDeadline(deadline) returns (uint256 musdOut) {
        (IERC20 musd, IERC20 pt) = _pair(market, pool);
        musdOut = pool.getAmountOut(ptIn, address(pt));
        if (musdOut < minMusdOut || musdOut == 0) revert Slippage();
        pt.safeTransferFrom(msg.sender, address(pool), ptIn);
        _swapOut(pool, address(musd), musdOut, to, "");
        emit SoldPrincipal(address(market), to, ptIn, musdOut);
    }

    /// @notice Receive exactly `ytOut` YT for at most `maxMusdIn` MUSD.
    /// @dev Flash swap: the pool first lends the MUSD that `ytOut` PT will
    ///      fetch, the router mints `ytOut` PT and YT with that MUSD plus the
    ///      caller's, pays the pool in PT and keeps nothing.
    function buyYield(
        TenorMarket market,
        ITigrisPool pool,
        uint256 ytOut,
        uint256 maxMusdIn,
        address to,
        uint256 deadline
    ) external beforeDeadline(deadline) returns (uint256 musdIn) {
        (IERC20 musd,) = _pair(market, pool);
        uint256 borrowed = pool.getAmountOut(ytOut, address(market.pt()));
        if (borrowed >= ytOut) revert NoQuote();
        musdIn = ytOut - borrowed;
        if (musdIn > maxMusdIn) revert Slippage();
        musd.safeTransferFrom(msg.sender, address(this), musdIn);
        _activePool = address(pool);
        _swapOut(pool, address(musd), borrowed, address(this), abi.encode(market, to, ytOut));
        _activePool = address(0);
        emit BoughtYield(address(market), to, musdIn, ytOut);
    }

    /// @inheritdoc ITigrisPoolCallee
    function hook(address sender, uint256, uint256, bytes calldata data) external {
        if (msg.sender != _activePool || sender != address(this)) revert UnexpectedCallback();
        (TenorMarket market, address to, uint256 ytOut) = abi.decode(data, (TenorMarket, address, uint256));
        IERC20 musd = market.musd();
        musd.forceApprove(address(market), ytOut);
        market.mint(ytOut, address(this));
        IERC20(address(market.pt())).safeTransfer(msg.sender, ytOut);
        IERC20(address(market.yt())).safeTransfer(to, ytOut);
    }

    // Quotes

    /// @notice PT received for `musdIn` MUSD.
    function quoteBuyPrincipal(TenorMarket market, ITigrisPool pool, uint256 musdIn) external view returns (uint256) {
        return pool.getAmountOut(musdIn, address(market.musd()));
    }

    /// @notice MUSD cost of exactly `ytOut` YT.
    function quoteBuyYield(TenorMarket market, ITigrisPool pool, uint256 ytOut) public view returns (uint256) {
        uint256 borrowed = pool.getAmountOut(ytOut, address(market.pt()));
        return borrowed >= ytOut ? type(uint256).max : ytOut - borrowed;
    }

    /// @notice Largest YT amount that costs at most `musdIn`, by bisection. For off-chain quotes.
    function quoteYieldForMusd(TenorMarket market, ITigrisPool pool, uint256 musdIn)
        external
        view
        returns (uint256 ytOut)
    {
        (uint256 r0, uint256 r1,) = pool.getReserves();
        uint256 hi = (pool.token0() == address(market.pt()) ? r0 : r1) / 2;
        uint256 lo;
        for (uint256 i; i < 96 && lo < hi; ++i) {
            uint256 mid = (lo + hi + 1) / 2;
            if (quoteBuyYield(market, pool, mid) <= musdIn) lo = mid;
            else hi = mid - 1;
        }
        ytOut = lo;
    }

    // Internals

    function _pair(TenorMarket market, ITigrisPool pool) private view returns (IERC20 musd, IERC20 pt) {
        musd = market.musd();
        pt = IERC20(address(market.pt()));
        address t0 = pool.token0();
        address t1 = pool.token1();
        bool ok = (t0 == address(pt) && t1 == address(musd)) || (t0 == address(musd) && t1 == address(pt));
        if (!ok) revert PoolMismatch();
    }

    function _swapOut(ITigrisPool pool, address tokenOut, uint256 amountOut, address to, bytes memory data) private {
        (uint256 a0, uint256 a1) = pool.token0() == tokenOut ? (amountOut, uint256(0)) : (uint256(0), amountOut);
        pool.swap(a0, a1, to, data);
    }
}

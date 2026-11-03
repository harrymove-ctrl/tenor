// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice The parts of a Tigris (Mezo) basic pool that Tenor uses.
/// @dev Matches mezo-org/tigris solidity/contracts/Pool.sol. `swap` sends the
///      outputs first, then calls `IPoolCallee(to).hook` when `data` is set,
///      then checks the invariant, so it doubles as a flash swap.
interface ITigrisPool {
    function token0() external view returns (address);

    function token1() external view returns (address);

    function stable() external view returns (bool);

    function getReserves() external view returns (uint256 reserve0, uint256 reserve1, uint256 blockTimestampLast);

    function getAmountOut(uint256 amountIn, address tokenIn) external view returns (uint256);

    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
}

interface ITigrisPoolCallee {
    function hook(address sender, uint256 amount0, uint256 amount1, bytes calldata data) external;
}

interface ITigrisPoolFactory {
    function createPool(address tokenA, address tokenB, bool stable) external returns (address pool);

    function getPool(address tokenA, address tokenB, bool stable) external view returns (address);
}

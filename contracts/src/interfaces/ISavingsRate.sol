// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice The parts of Mezo's MUSDSavingsRate (sMUSD) that Tenor uses.
/// @dev sMUSD mints 1:1 for MUSD and pays yield as claimable MUSD through a
///      global index that is settled for both sides on every transfer.
///      Mainnet 0xb4D498029af77680cD1eF828b967f010d06C51CC,
///      testnet 0x6f461c68B2c5492C0F5CCEc5a264d692aA7A8e16.
interface ISavingsRate is IERC20 {
    function musdToken() external view returns (address);

    function deposit(uint256 amount) external;

    function withdraw(uint256 amount) external;

    function claimYield() external returns (uint256);

    function receiveProtocolYield(uint256 amount) external;

    function yieldIndex() external view returns (uint256);

    function supplyYieldIndex(address account) external view returns (uint256);

    function claimableYield(address account) external view returns (uint256);
}

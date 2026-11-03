// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISavingsRate} from "./interfaces/ISavingsRate.sol";
import {TenorMarket} from "./TenorMarket.sol";

/// @title TenorFactory
/// @notice Creates one TenorMarket per maturity at a deterministic address.
///         Anyone can create a market; fee settings are fixed at deployment.
contract TenorFactory {
    ISavingsRate public immutable smusd;
    address public immutable feeRecipient;
    uint256 public immutable feeBps;

    address[] public markets;
    mapping(uint256 maturity => address market) public marketOf;

    event MarketCreated(uint256 indexed maturity, address market, address pt, address yt, string label);

    error MarketExists();

    constructor(ISavingsRate smusd_, address feeRecipient_, uint256 feeBps_) {
        smusd = smusd_;
        feeRecipient = feeRecipient_;
        feeBps = feeBps_;
    }

    function createMarket(uint256 maturity, string calldata label) external returns (TenorMarket market) {
        if (marketOf[maturity] != address(0)) revert MarketExists();
        market = new TenorMarket{salt: bytes32(maturity)}(smusd, maturity, feeRecipient, feeBps, label);
        marketOf[maturity] = address(market);
        markets.push(address(market));
        emit MarketCreated(maturity, address(market), address(market.pt()), address(market.yt()), label);
    }

    function marketCount() external view returns (uint256) {
        return markets.length;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

interface ITenorCheckpoint {
    function checkpoint(address from, address to) external;
}

/// @title TenorToken
/// @notice Principal (PT) or yield (YT) token of one Tenor market.
/// @dev Only the market that deployed it can mint and burn. Every balance
///      change first asks the market to settle yield for both sides, the
///      same pattern sMUSD uses in `_beforeTokenTransfer`, so a transfer
///      never moves yield that was already earned.
contract TenorToken is ERC20Permit {
    address public immutable market;

    error OnlyMarket();

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) ERC20Permit(name_) {
        market = msg.sender;
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != market) revert OnlyMarket();
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        if (msg.sender != market) revert OnlyMarket();
        _burn(from, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        ITenorCheckpoint(market).checkpoint(from, to);
        super._update(from, to, value);
    }
}

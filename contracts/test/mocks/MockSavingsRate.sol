// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockMUSD is ERC20 {
    constructor() ERC20("Mezo USD", "MUSD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice Reproduces the accounting of Mezo's MUSDSavingsRate (mezo-org/musd)
///         that Tenor depends on: 1:1 deposit and withdraw, a global yield
///         index settled on every transfer, `withdraw` claiming the caller's
///         yield first, and permissionless `receiveProtocolYield`.
/// @dev `pendingProtocolYield` stands in for PCV: it is pushed into the index
///      at the start of `deposit` and `withdraw`, as `pcv.distributeMUSD()`
///      does on mainnet. The real contract is exercised in test/fork.
contract MockSavingsRate is ERC20 {
    IERC20 public immutable musd;
    uint256 public yieldIndex;
    mapping(address => uint256) public supplyYieldIndex;
    mapping(address => uint256) public claimableYield;
    uint256 public pendingProtocolYield;

    constructor(IERC20 musd_) ERC20("MUSD Savings Rate", "sMUSD") {
        musd = musd_;
    }

    function musdToken() external view returns (address) {
        return address(musd);
    }

    function deposit(uint256 amount) external {
        _distributePending();
        musd.transferFrom(msg.sender, address(this), amount);
        _mint(msg.sender, amount);
    }

    function withdraw(uint256 amount) external {
        _distributePending();
        _claim(msg.sender);
        _burn(msg.sender, amount);
        musd.transfer(msg.sender, amount);
    }

    function claimYield() external returns (uint256) {
        return _claim(msg.sender);
    }

    function receiveProtocolYield(uint256 amount) external {
        musd.transferFrom(msg.sender, address(this), amount);
        _receive(amount);
    }

    /// @dev Test hook: queue yield that the next deposit or withdraw distributes.
    function queueProtocolYield(uint256 amount) external {
        musd.transferFrom(msg.sender, address(this), amount);
        pendingProtocolYield += amount;
    }

    function _distributePending() private {
        uint256 p = pendingProtocolYield;
        if (p > 0 && totalSupply() > 0) {
            pendingProtocolYield = 0;
            _receive(p);
        }
    }

    function _receive(uint256 amount) private {
        uint256 supply = totalSupply();
        require(supply > 0, "no supply");
        uint256 ratio = (amount * 1e18) / supply;
        require(ratio > 0, "AmountTooSmall");
        yieldIndex += ratio;
    }

    function _claim(address account) private returns (uint256 amount) {
        _updateFor(account);
        amount = claimableYield[account];
        if (amount > 0) {
            claimableYield[account] = 0;
            musd.transfer(account, amount);
        }
    }

    function _updateFor(address account) private {
        uint256 bal = balanceOf(account);
        uint256 idx = yieldIndex;
        if (bal > 0) {
            uint256 delta = idx - supplyYieldIndex[account];
            if (delta > 0) claimableYield[account] += (bal * delta) / 1e18;
        }
        supplyYieldIndex[account] = idx;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != to) {
            if (from != address(0)) _updateFor(from);
            if (to != address(0)) _updateFor(to);
        }
        super._update(from, to, value);
    }
}

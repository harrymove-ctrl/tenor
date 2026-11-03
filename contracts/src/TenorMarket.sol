// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISavingsRate} from "./interfaces/ISavingsRate.sol";
import {TenorToken, ITenorCheckpoint} from "./TenorToken.sol";

/// @title TenorMarket
/// @notice Splits sMUSD into a principal token (PT, redeems for 1 MUSD at
///         maturity) and a yield token (YT, receives all sMUSD yield until
///         maturity) for one fixed maturity.
/// @dev Every PT is backed by exactly one sMUSD held unstaked by this
///      contract. Yield is pulled with `sMUSD.claimYield()` and spread over
///      YT holders through `ytIndex` until the market settles at maturity,
///      then over PT holders who have not redeemed yet through `ptIndex`.
///      No owner, no pause, no upgrade path.
contract TenorMarket is ITenorCheckpoint {
    using SafeERC20 for IERC20;

    uint256 private constant ONE = 1e18;
    uint256 public constant MAX_FEE_BPS = 1_000;

    ISavingsRate public immutable smusd;
    IERC20 public immutable musd;
    TenorToken public immutable pt;
    TenorToken public immutable yt;
    uint256 public immutable maturity;
    address public immutable feeRecipient;
    uint256 public immutable feeBps;

    /// @notice Cumulative MUSD yield per YT, scaled by 1e18. Frozen at settlement.
    uint256 public ytIndex;
    /// @notice Cumulative MUSD yield per PT after settlement, scaled by 1e18.
    uint256 public ptIndex;
    /// @notice True once the first harvest at or after maturity has paid YT.
    bool public settled;
    /// @notice MUSD owed to the fee recipient.
    uint256 public feesOwed;
    /// @notice MUSD already settled into `owed` and not yet paid out.
    uint256 public totalOwed;

    mapping(address => uint256) public ytCheckpoint;
    mapping(address => uint256) public ptCheckpoint;
    mapping(address => uint256) public owed;

    uint256 private _status = 1;

    event Minted(address indexed caller, address indexed to, uint256 amount);
    event Combined(address indexed caller, address indexed to, uint256 amount, uint256 yieldPaid);
    event Redeemed(address indexed caller, address indexed to, uint256 amount, uint256 yieldPaid);
    event Claimed(address indexed account, address indexed to, uint256 amount);
    event Harvested(uint256 amount, uint256 fee, bool toPrincipal);
    event Settled(uint256 finalYtIndex);
    event FeesCollected(uint256 amount);

    error ZeroAmount();
    error ZeroAddress();
    error Matured();
    error NotMatured();
    error FeeTooHigh();
    error BadMaturity();
    error Reentrancy();
    error OnlyToken();

    modifier lock() {
        if (_status != 1) revert Reentrancy();
        _status = 2;
        _;
        _status = 1;
    }

    constructor(ISavingsRate smusd_, uint256 maturity_, address feeRecipient_, uint256 feeBps_, string memory label) {
        if (address(smusd_) == address(0) || feeRecipient_ == address(0)) revert ZeroAddress();
        if (maturity_ <= block.timestamp) revert BadMaturity();
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh();
        smusd = smusd_;
        musd = IERC20(smusd_.musdToken());
        maturity = maturity_;
        feeRecipient = feeRecipient_;
        feeBps = feeBps_;
        pt = new TenorToken(string.concat("Tenor Principal sMUSD ", label), string.concat("PT-sMUSD-", label));
        yt = new TenorToken(string.concat("Tenor Yield sMUSD ", label), string.concat("YT-sMUSD-", label));
    }

    // Entry points

    /// @notice Deposit MUSD into sMUSD and receive `amount` PT and `amount` YT.
    function mint(uint256 amount, address to) external lock {
        _checkMint(amount, to);
        _harvest();
        musd.safeTransferFrom(msg.sender, address(this), amount);
        musd.forceApprove(address(smusd), amount);
        smusd.deposit(amount);
        pt.mint(to, amount);
        yt.mint(to, amount);
        emit Minted(msg.sender, to, amount);
    }

    /// @notice Same as `mint`, starting from sMUSD the caller already holds.
    function mintFromSavings(uint256 amount, address to) external lock {
        _checkMint(amount, to);
        _harvest();
        IERC20(address(smusd)).safeTransferFrom(msg.sender, address(this), amount);
        pt.mint(to, amount);
        yt.mint(to, amount);
        emit Minted(msg.sender, to, amount);
    }

    /// @notice Before maturity, burn equal PT and YT for MUSD plus the caller's yield.
    function combine(uint256 amount, address to) external lock returns (uint256 paid) {
        if (amount == 0) revert ZeroAmount();
        if (block.timestamp >= maturity) revert Matured();
        _harvest();
        // Withdraw before burning: yield that sMUSD releases inside `withdraw`
        // must be indexed while the caller still holds the tokens.
        _withdraw(amount);
        pt.burn(msg.sender, amount);
        yt.burn(msg.sender, amount);
        uint256 yieldPaid = _takeOwed(msg.sender);
        paid = amount + yieldPaid;
        musd.safeTransfer(to, paid);
        emit Combined(msg.sender, to, amount, yieldPaid);
    }

    /// @notice After maturity, burn PT for 1 MUSD each plus the caller's yield.
    function redeem(uint256 amount, address to) external lock returns (uint256 paid) {
        if (amount == 0) revert ZeroAmount();
        if (block.timestamp < maturity) revert NotMatured();
        _harvest();
        _withdraw(amount);
        pt.burn(msg.sender, amount);
        uint256 yieldPaid = _takeOwed(msg.sender);
        paid = amount + yieldPaid;
        musd.safeTransfer(to, paid);
        emit Redeemed(msg.sender, to, amount, yieldPaid);
    }

    /// @notice Pay out all yield the caller has earned on PT and YT.
    function claim(address to) external lock returns (uint256 paid) {
        _harvest();
        _settle(msg.sender);
        paid = _takeOwed(msg.sender);
        if (paid > 0) musd.safeTransfer(to, paid);
        emit Claimed(msg.sender, to, paid);
    }

    /// @notice Pull pending sMUSD yield into the indexes. Anyone can call it.
    function harvest() external lock {
        _harvest();
    }

    /// @notice Send accrued fees to the immutable fee recipient. Anyone can call it.
    function collectFees() external lock returns (uint256 amount) {
        amount = feesOwed;
        feesOwed = 0;
        if (amount > 0) musd.safeTransfer(feeRecipient, amount);
        emit FeesCollected(amount);
    }

    /// @inheritdoc ITenorCheckpoint
    /// @dev Called by PT and YT before every balance change. Outside a market
    ///      call it harvests first, so a plain transfer or a pool swap settles
    ///      yield that sMUSD has already credited to this contract.
    function checkpoint(address from, address to) external {
        if (msg.sender != address(pt) && msg.sender != address(yt)) revert OnlyToken();
        if (_status == 1) {
            _status = 2;
            _harvest();
            _status = 1;
        }
        if (from != address(0)) _settle(from);
        if (to != address(0) && to != from) _settle(to);
    }

    // Views

    /// @notice MUSD the account could claim right now, including sMUSD yield not yet harvested.
    function claimable(address account) external view returns (uint256) {
        (uint256 ytI, uint256 ptI) = _previewIndexes();
        return owed[account] + (yt.balanceOf(account) * (ytI - ytCheckpoint[account])) / ONE
            + (pt.balanceOf(account) * (ptI - ptCheckpoint[account])) / ONE;
    }

    /// @notice sMUSD yield credited to this market and not yet harvested.
    function pendingYield() public view returns (uint256) {
        uint256 delta = smusd.yieldIndex() - smusd.supplyYieldIndex(address(this));
        return smusd.claimableYield(address(this)) + (smusd.balanceOf(address(this)) * delta) / 1e18;
    }

    // Internals

    function _checkMint(uint256 amount, address to) private view {
        if (amount == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();
        if (block.timestamp >= maturity) revert Matured();
    }

    function _harvest() private {
        uint256 amount = smusd.claimYield();
        if (amount > 0) _distribute(amount);
        if (!settled && block.timestamp >= maturity) {
            // Yield harvested in the call above was earned before maturity and
            // went to YT. From here on, yield goes to PT holders who wait.
            settled = true;
            emit Settled(ytIndex);
        }
    }

    function _distribute(uint256 amount) private {
        uint256 fee = (amount * feeBps) / 10_000;
        uint256 rest = amount - fee;
        bool toPrincipal = settled;
        uint256 supply = toPrincipal ? pt.totalSupply() : yt.totalSupply();
        if (supply == 0) {
            fee += rest;
        } else if (toPrincipal) {
            ptIndex += (rest * ONE) / supply;
        } else {
            ytIndex += (rest * ONE) / supply;
        }
        feesOwed += fee;
        emit Harvested(amount, fee, toPrincipal);
    }

    /// @dev `sMUSD.withdraw` claims the caller's yield before burning, and can
    ///      itself pull fresh protocol yield first, so book any MUSD above the
    ///      principal as yield.
    function _withdraw(uint256 amount) private {
        uint256 before = musd.balanceOf(address(this));
        smusd.withdraw(amount);
        uint256 received = musd.balanceOf(address(this)) - before;
        if (received > amount) _distribute(received - amount);
    }

    function _settle(address account) private {
        uint256 ytI = ytIndex;
        uint256 ptI = ptIndex;
        uint256 accrued = (yt.balanceOf(account) * (ytI - ytCheckpoint[account])) / ONE
            + (pt.balanceOf(account) * (ptI - ptCheckpoint[account])) / ONE;
        ytCheckpoint[account] = ytI;
        ptCheckpoint[account] = ptI;
        if (accrued > 0) {
            owed[account] += accrued;
            totalOwed += accrued;
        }
    }

    function _takeOwed(address account) private returns (uint256 amount) {
        amount = owed[account];
        if (amount > 0) {
            owed[account] = 0;
            totalOwed -= amount;
        }
    }

    function _previewIndexes() private view returns (uint256 ytI, uint256 ptI) {
        ytI = ytIndex;
        ptI = ptIndex;
        uint256 pending = pendingYield();
        if (pending == 0) return (ytI, ptI);
        uint256 rest = pending - (pending * feeBps) / 10_000;
        bool toPrincipal = settled;
        uint256 supply = toPrincipal ? pt.totalSupply() : yt.totalSupply();
        if (supply == 0) return (ytI, ptI);
        if (toPrincipal) ptI += (rest * ONE) / supply;
        else ytI += (rest * ONE) / supply;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockMUSD, MockSavingsRate} from "../test/mocks/MockSavingsRate.sol";
import {Pool} from "../test/vendor/tigris/Pool.sol";
import {PoolFactory} from "../test/vendor/tigris/factories/PoolFactory.sol";

/// @notice Stands up a local stand-in for Mezo on anvil so ops/ can rehearse
///         deploy, seed and prove end to end: MUSD, an sMUSD that follows
///         MUSDSavingsRate accounting, and the real Tigris PoolFactory.
/// @dev forge script script/LocalMezo.s.sol --rpc-url http://127.0.0.1:8547 --broadcast \
///        --private-key <anvil key 0>
contract LocalMezo is Script {
    function run() external {
        address deployer = vm.addr(vm.envUint("LOCAL_DEPLOYER_KEY"));
        vm.startBroadcast();
        MockMUSD musd = new MockMUSD();
        MockSavingsRate smusd = new MockSavingsRate(IERC20(address(musd)));
        PoolFactory factory = new PoolFactory(address(new Pool()));
        musd.mint(deployer, 10_000_000e18);
        // Background sMUSD holders, so the market is not the only depositor.
        musd.approve(address(smusd), type(uint256).max);
        smusd.deposit(900_000e18);
        vm.stopBroadcast();

        string memory j = "mezo";
        vm.serializeAddress(j, "musd", address(musd));
        vm.serializeAddress(j, "smusd", address(smusd));
        vm.serializeAddress(j, "poolFactory", address(factory));
        string memory out = vm.serializeAddress(j, "btc", address(0));
        vm.writeJson(out, "../deployments/local-mezo.json");
    }
}

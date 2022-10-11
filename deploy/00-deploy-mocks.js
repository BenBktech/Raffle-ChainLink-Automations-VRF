const { developementChains } = require("../helper_hardhat-config");
const { network } = require("hardhat");

const BASE_FEE = ethers.utils.parseEther("0.25"); //it cost 0.25LINK per request //https://docs.chain.link/docs/vrf/v2/direct-funding/supported-networks/#goerli-testnet
const GAS_PRICE_LINK = 1e9 //1000000000 //calculated value based on the gas price of the chain

module.exports = async function({ getNamedAccounts, deployments }) {
    const { deploy, log}  = deployments 
    const { deployer } = await getNamedAccounts() 
    const chainId = network.config.chainId;

    const args = [BASE_FEE, GAS_PRICE_LINK]

    if(chainId == 31337) {
        log("Local network detected! Deploying mocks...");
        await deploy("VRFCoordinatorV2Mock", {
            from: deployer,
            log: true,
            args: args
        });
        log("Mock deployed!");
        log("----------------------");
    }
}

module.exports.tags = ["all", "mocks"];
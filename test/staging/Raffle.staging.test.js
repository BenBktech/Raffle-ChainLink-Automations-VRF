const { assert, expect } = require("chai");
const { getNamedAccounts, deployments, ethers, network } = require("hardhat");
const { developmentChains, networkConfig } = require("../../helper_hardhat-config");

developmentChains.includes(network.name) 
    ? describe.skip
    : 
    describe("Raffle Unit Tests", function() {
    let raffle, raffleEntranceFee, deployer

    beforeEach(async function() {
        deployer = (await getNamedAccounts()).deployer
        raffle = await ethers.getContract("Raffle", deployer);
        raffleEntranceFee = await raffle.getEntranceFee()
    })

    describe("fulfillRandomWords", function() {
        it("works with live ChainLink Keepers and ChainLink VRF, we get a random winner", async function() {
            // enter the raffle 
            // setup listener before we enter the raffle just in case the blockchain moves really fast
            const startingTimeStamp = await raffle.getLatestTimestamp()
            const accounts = await ethers.getSigners()

            await new Promise(async(resolve, reject) => {
                raffle.once("WinnerPicked", async() => {
                    console.log("WinnerPiciked event fired!")
                    try {
                        const recentWinner = await raffle.getRecentWinner() 
                        const raffleState = await raffle.getRaffleState() 
                        const winnerEndingBalance = await accounts[0].getBalance() 
                        const endingTimeStamp = await raffle.getLatestTimestamp()

                        await expect(raffle.getPlayer(0)).to.be.reverted
                        assert.equal(recentWinner.toString(), accounts[0].address)
                        assert.equal(raffleState, 0) 
                        assert.equal(
                            winnerEndingBalance.toString(), 
                            winnerStartingBalance.add(raffleEntranceFee).toString()
                        )
                        assert(endingTimeStamp > startingTimeStamp)
                        resolve()
                    }
                    catch(e) {
                        reject(e)
                    }
                })
                await raffle.enterRaffle({ value: raffleEntranceFee })
                const winnerStartingBalance = await accounts[0].getBalance()
            })

            
        })
    }) 
})
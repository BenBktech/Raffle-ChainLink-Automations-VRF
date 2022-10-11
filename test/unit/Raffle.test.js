const { assert, expect } = require("chai");
const { getNamedAccounts, deployments, ethers, network } = require("hardhat");
const { developmentChains, networkConfig } = require("../../helper_hardhat-config");

!developmentChains.includes(network.name) 
    ? describe.skip 
    : describe("Raffle Unit Tests", function() {
        let raffle, vrfCoordinatorV2Mock, raffleEntranceFee, deployer, interval, player
        const chainId = network.config.chainId;

        beforeEach(async function() {
            deployer = (await getNamedAccounts()).deployer
            await deployments.fixture(["mocks", "raffle"]) 
            raffle = await ethers.getContract("Raffle", deployer);
            vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer)
            raffleEntranceFee = await raffle.getEntranceFee()
            interval = await raffle.getInterval()
        })

        describe("constructor", function() {
            it("initializes the raffle correctly", async function() {
                const raffleState = (await raffle.getRaffleState()).toString()
                const interval = await raffle.getInterval() 

                assert.equal(raffleState.toString(), "0")
                assert.equal(interval.toString(), networkConfig[chainId]["interval"]);
            })
        })

        describe("enterRaffle", function() {
            it("reverts if you don't pay enought", async function() {
                await expect(raffle.enterRaffle()).to.be.revertedWith("Raffle__NotEnoughETHEntered");
            })
            it("records players when they enter", async function() {
                await raffle.enterRaffle({value: raffleEntranceFee})
                const playerFromContract = await raffle.getPlayer(0)
                assert.equal(playerFromContract, deployer);
            })
            it("emits event on enter", async function() {
                await expect(raffle.enterRaffle({value: raffleEntranceFee})).to.emit(raffle, "RaffleEnter")
            })
            it("doesn't allow entrance when raffle is calculating", async function() {
                await raffle.enterRaffle({ value: raffleEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.request({ method: "evm_mine", params: [] })
                // we prend to be a keeper for a second 
                await raffle.performUpkeep([])
                await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.be.revertedWith( // is reverted as raffle is calculating
                      "Raffle__NotOpen"
                )
            })
            describe("checkUpkeep", function() {
                it("returns false if people haven't sent any ETH", async function() {
                    await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                    await network.provider.send("evm_mine", []);
                    // callstatic doesnt send transaction (public function) but only execute the function
                    const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([])
                    assert(!upkeepNeeded)

                })
                it("returns false if raffle isn't open", async function() {
                    await raffle.enterRaffle({value: raffleEntranceFee})
                    await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                    await network.provider.send("evm_mine", []);
                    // Here 0x allows to send a blank object too
                    await raffle.performUpkeep([])
                    const raffleState = await raffle.getRaffleState() 
                    const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([])
                    assert.equal(raffleState.toString(), "1")
                    assert.equal(upkeepNeeded, false)
                })
                it("returns false if enough time hasn't passed", async () => {
                    await raffle.enterRaffle({ value: raffleEntranceFee })
                    await network.provider.send("evm_increaseTime", [interval.toNumber() - 5]) // use a higher number here if this test fails
                    await network.provider.request({ method: "evm_mine", params: [] })
                    const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x") // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                    assert(!upkeepNeeded)
                })
                it("returns true if enough time has passed, has players, eth, and is open", async () => {
                    await raffle.enterRaffle({ value: raffleEntranceFee })
                    await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                    await network.provider.request({ method: "evm_mine", params: [] })
                    const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x") // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                    assert(upkeepNeeded)
                })
            })
            describe("performUpkeep", function() {
                it("can only work if checkupkeep is true", async function() {
                    await raffle.enterRaffle({ value : raffleEntranceFee })
                    await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                    await network.provider.send("evm_mine", [])
                    const tx = await raffle.performUpkeep([]) //[] = "0x"
                    assert(tx)
                })
                it("reverts when checkupkeep is false", async function() {
                    await expect(raffle.performUpkeep([])).to.be.revertedWith(
                        "Raffle__UpkeepNotNeeded"
                    )
                })
                it("updates the raffle state, emits an event and calls the vrf coordinator", async function() {
                    await raffle.enterRaffle({ value : raffleEntranceFee })
                    await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                    await network.provider.send("evm_mine", [])
                    const txResponse = await raffle.performUpkeep([])
                    const txReceipt = await txResponse.wait(1)
                    // Here we get the event 1 and not the event 0 because 
                    // VRFCoordinatorV2Mock.sol is emeting also an event just before
                    // and, just so you know, you could get the requestId thanks to
                    // the VRFCoordinatorV2Mock.sol event ;) so my code is a little bit
                    // redondant
                    const requestId = txReceipt.events[1].args.requestId;
                    const raffleState = await raffle.getRaffleState()
                    assert(requestId.toNumber() > 0) 
                    assert(raffleState.toString() == "1")
                })
            })
            describe("fulfillRandomWords", function() {
                beforeEach(async function() {
                    /* Before we try to test the fulfillRandomWords, someone will go in the lottery, we will increase time and mine a new block
                    */
                    await raffle.enterRaffle({ value : raffleEntranceFee })
                    await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                    await network.provider.send("evm_mine", []);
                })
                it("can only be called after performUpkeep", async function() {
                    await expect(vrfCoordinatorV2Mock.fulfillRandomWords(0, raffle.address)).to.be.revertedWith("nonexistent request");
                    await expect(vrfCoordinatorV2Mock.fulfillRandomWords(1, raffle.address)).to.be.revertedWith("nonexistent request");
                })
                /////
                it("picks a winner, resets the lottery, and sends money", async function() {
                    const additionalEntrants = 3
                    const startingAccountIndex = 1 // deployer = 0
                    const accounts = await ethers.getSigners()
                    for(let i = startingAccountIndex ; i < startingAccountIndex + additionalEntrants ; i++) {
                        const accountConnectedRaffle = raffle.connect(accounts[i])
                        await accountConnectedRaffle.enterRaffle({ value: raffleEntranceFee })
                    }
                    const startingTimeStamp = await raffle.getLatestTimestamp()

                    // performUpKeep (mock being chainlink keepers) 
                    // fulfillRandomWords (mock being the cChainLink VRF)
                    // we will have to wait for the fulfillRandomWords to be called 
                    // WE DO THINGS LIKE THIS BECAUSE WE TEST ON HARDHAT and not on a testnet
                    await new Promise(async (resolve, reject) => {
                        // Once WinnerPicked event happens, do some stuff ...
                        raffle.once("WinnerPicked", async () => {
                            try {
                                
                                console.log(accounts[0].address)
                                console.log(accounts[1].address)
                                console.log(accounts[2].address)
                                console.log(accounts[3].address)
                                const recentWinner = await raffle.getRecentWinner() 
                                console.log("Recent Winner : "+ recentWinner) 
                                const raffleState = await raffle.getRaffleState() 
                                const endingTimeStamp = await raffle.getLatestTimestamp() 
                                const numPlayers = await raffle.getNumberOfPlayers() 
                                const winnerEndingBalance = await accounts[1].getBalance();
                                assert.equal(numPlayers.toString(), "0")
                                assert.equal(raffleState.toString(), "0");
                                assert(endingTimeStamp > startingTimeStamp)

                                assert.equal(winnerEndingBalance.toString(), winnerStartingBalance.add(raffleEntranceFee.mul(additionalEntrants).add(raffleEntranceFee).toString()))
                            }
                            catch(e) {
                                reject(e)
                            }
                            resolve()
                        })
                        // Setting up the listener 
                        // Below, we will fire the event, and the listener will pick it up and resolve 
                        const tx = await raffle.performUpkeep([])
                        const txReceipt = await tx.wait(1) 
                        const winnerStartingBalance = await accounts[1].getBalance()
                        await vrfCoordinatorV2Mock.fulfillRandomWords(
                            txReceipt.events[1].args.requestId,
                            raffle.address
                        )                        
                    })
                })
            })
        })
    })
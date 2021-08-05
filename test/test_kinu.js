const { ethers } = require("hardhat");
const { describe } = require("mocha");
let chai = require("chai");
chai.use(require("chai-as-promised"));
const { assert, expect } = chai;
const { BigNumber } = ethers;
const { MaxUint256 } = ethers.constants;
const { parseEther } = ethers.utils;

const ETH_BALANCE_THRESHOLD = parseEther("0.001");
const INITIAL_KINU_RESERVES = parseEther("500000000");
const INITIAL_ETH_RESERVES = parseEther("100");

let kinu;
let owner;
let rewardAcct1;
let rewardAcct2;
let liqAcct;
let noFeesAcct;

async function setUp() {
  const IterableMapping = await ethers.getContractFactory("IterableMapping");
  const iterableMapping = await IterableMapping.deploy();
  await iterableMapping.deployed();

  const KINU = await ethers.getContractFactory("KINU", {
    libraries: {
      IterableMapping: iterableMapping.address,
    },
  });
  kinu = await KINU.deploy();
  await kinu.deployed();

  [owner, rewardAcct1, rewardAcct2, liqAcct, noFeesAcct] =
    await ethers.getSigners();

  // Add initial liquidity.
  const routerAddress = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
  let router = await ethers.getContractAt("IUniswapV2Router02", routerAddress);

  await expect(kinu.approve(routerAddress, MaxUint256)).to.eventually.be
    .fulfilled;
  await expect(
    router.addLiquidityETH(
      kinu.address,
      INITIAL_KINU_RESERVES,
      parseEther("0"), // slippage is unavoidable
      parseEther("0"), // slippage is unavoidable
      liqAcct.address,
      MaxUint256,
      { value: INITIAL_ETH_RESERVES }
    )
  ).to.eventually.be.fulfilled;
}

describe("KINU", function () {
  before(setUp);

  it("should return correct name", async function () {
    await expect(kinu.name()).to.eventually.equal("KINU");
  });

  it("should return correct symbol", async function () {
    await expect(kinu.symbol()).to.eventually.equal("KINU");
  });

  it("should have the 1B supply", async function () {
    await expect(kinu.totalSupply()).to.eventually.equal(
      parseEther("1000000000")
    );
  });

  it("should use anti bot by default", async function () {
    await expect(kinu.useAntiBot()).to.eventually.be.true;
  });


  it("should allow accounts to transfer before go-live", async function () {
    await expect(kinu.canTransferBeforeTradingIsEnabled(noFeesAcct.address)).to
      .eventually.be.false;
    await expect(kinu.allowTransferBeforeTradingIsEnabled(noFeesAcct.address))
      .to.be.fulfilled;
    await expect(kinu.canTransferBeforeTradingIsEnabled(noFeesAcct.address)).to
      .eventually.be.true;
  });

  it("should exclude account from fees", async function () {
    await expect(kinu.isExcludedFromFees(noFeesAcct.address)).to.eventually.be
      .false;
    await expect(kinu.excludeFromFees(noFeesAcct.address)).to.eventually.be
      .fulfilled;
    await expect(kinu.isExcludedFromFees(noFeesAcct.address)).to.eventually.be
      .true;
  });

  it("should allow assigning anti bot address", async function () {
    const tx = expect(
      kinu.updateAntiBot("0xCD5312d086f078D1554e8813C27Cf6C9D1C3D9b3")
    );
    await tx.to.emit(kinu, "UpdatedAntiBot");
    await tx.to.eventually.be.fulfilled;
  });

  it("should use 18 decimals", async function () {
    await expect(kinu.decimals()).to.eventually.equal(BigNumber.from(18));
  });

  it("should return the max sell token amount", async function () {
    await expect(kinu.MAX_SELL_TRANSACTION_AMOUNT()).to.eventually.equal(
      parseEther("1000000")
    );
  });

  it("should return the liquidation amount threshold", async function () {
    await expect(kinu.liquidateTokensAtAmount()).to.eventually.equal(
      parseEther("100000")
    );
  });

  it("should update the liquidation amount threshold", async function () {
    await expect(kinu.updateLiquidationThreshold(parseEther("200001"))).to
      .eventually.be.rejected;

    const tx = expect(kinu.updateLiquidationThreshold(parseEther("80000")));
    await tx.to
      .emit(kinu, "LiquidationThresholdUpdated")
      .withArgs(parseEther("80000"), parseEther("100000"));
    await tx.to.eventually.be.fulfilled;
  });

  it("should have the correct owner", async function () {
    await expect(kinu.owner()).to.eventually.equal(owner.address);
  });

  it("should enforce the onlyOwner modifier", async function () {
    await expect(
      kinu.connect(noFeesAcct).excludeFromFees(noFeesAcct.address, true)
    ).to.eventually.be.rejected;
  });

  it("should have the correct liquidityWallet", async function () {
    await expect(kinu.liquidityWallet()).to.eventually.equal(owner.address);
  });

  it("should allow owner to update the liquidityWallet", async function () {
    await expect(kinu.updateLiquidityWallet(liqAcct.address)).to.eventually.be
      .fulfilled;
    await expect(kinu.liquidityWallet()).to.eventually.equal(liqAcct.address);
  });

  it("should update the gas for processing dividends", async function () {
    await expect(kinu.updateGasForProcessing(400000)).to.eventually.be
      .fulfilled;
  });

  it("should have the correct ETH rewards fee", async function () {
    await expect(kinu.ETH_REWARDS_FEE()).to.eventually.equal(BigNumber.from(4));
  });

  it("should have the correct liquidity fee", async function () {
    await expect(kinu.LIQUIDITY_FEE()).to.eventually.equal(BigNumber.from(2));
  });

  it("should have the correct total fee", async function () {
    await expect(kinu.TOTAL_FEES()).to.eventually.equal(BigNumber.from(6));
  });

  it("should have claim wait set to 1 hour by default", async function () {
    await expect(kinu.getClaimWait()).to.eventually.equal(BigNumber.from(3600));
  });

  it("should return whether account is excluded from fees", async function () {
    await expect(kinu.isExcludedFromFees(owner.address)).to.eventually.be.true;
    await expect(kinu.isExcludedFromFees(liqAcct.address)).to.eventually.be
      .true;
    await expect(kinu.isExcludedFromFees(noFeesAcct.address)).to.eventually.be
      .true;
    await expect(kinu.isExcludedFromFees(rewardAcct1.address)).to.eventually.be
      .false;
  });

  it("should always have the uniswap pair in the AMM pairs", async function () {
    const uniPairAddress = await kinu.uniswapV2Pair();
    await expect(kinu.automatedMarketMakerPairs(uniPairAddress)).to.eventually
      .be.true;
  });

  it("should only allow owner to transfer prior to go-live", async function () {
    await expect(kinu.tradingEnabled()).to.eventually.be.false;

    await expect(kinu.approve(owner.address, parseEther("10000"))).to.eventually
      .be.fulfilled;
    await expect(
      kinu.transferFrom(owner.address, rewardAcct1.address, parseEther("10000"))
    ).to.eventually.be.fulfilled;

    await expect(
      kinu.connect(rewardAcct1).approve(owner.address, parseEther("1"))
    ).to.eventually.be.fulfilled;
    await expect(
      kinu.transferFrom(
        rewardAcct1.address,
        noFeesAcct.address,
        parseEther("1")
      )
    ).to.eventually.be.rejected;
  });
  
});

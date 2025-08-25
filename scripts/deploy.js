const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  // Deploy Factory
  const Factory = await hre.ethers.getContractFactory("UniswapV3Factory");
  const factory = await Factory.deploy();
  await factory.deployed();
  console.log("Factory deployed to:", factory.address);

  // Deploy Quoter
  const Quoter = await hre.ethers.getContractFactory("Quoter");
  const quoter = await Quoter.deploy(factory.address);
  await quoter.deployed();
  console.log("Quoter deployed to:", quoter.address);

  // Deploy Router
  const Router = await hre.ethers.getContractFactory("SwapRouter");
  const router = await Router.deploy(factory.address, /*WETH address*/);
  await router.deployed();
  console.log("Router deployed to:", router.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
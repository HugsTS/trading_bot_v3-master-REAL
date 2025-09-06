require("dotenv").config()
const ethers = require('ethers')

const config = require('../config.json')
const IUniswapV3Factory = require('@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Factory.sol/IUniswapV3Factory.json')
const IQuoter = require('@uniswap/v3-periphery/artifacts/contracts/interfaces/IQuoterV2.sol/IQuoterV2.json')
const ISwapRouter = require('@uniswap/v3-periphery/artifacts/contracts/interfaces/ISwapRouter.sol/ISwapRouter.json')

let provider

function createProvider() {
  if (config.PROJECT_SETTINGS.isLocal) {
    return new ethers.WebSocketProvider(`ws://127.0.0.1:8545/`)
  } else {
    return new ethers.WebSocketProvider(`wss://arb-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`)
  }
}

provider = createProvider()

// Reconnection logic
function setupReconnection() {
  if (provider._websocket) {
    provider._websocket.on('close', async () => {
      console.log('WebSocket closed, reconnecting...');
      provider = createProvider();
      setupReconnection();
    });
    provider._websocket.on('error', async (err) => {
      console.log('WebSocket error:', err);
      provider = createProvider();
      setupReconnection();
    });
  }
}
setupReconnection();

// -- SETUP UNISWAP/PANCAKESWAP CONTRACTS -- //
const uniswap = {
  name: "Uniswap V3",
  factory: new ethers.Contract(config.UNISWAP.FACTORY_V3, IUniswapV3Factory.abi, provider),
  quoter: new ethers.Contract(config.UNISWAP.QUOTER_V3, IQuoter.abi, provider),
  router: new ethers.Contract(config.UNISWAP.ROUTER_V3, ISwapRouter.abi, provider)
}

const pancakeswap = {
  name: "Pancakeswap V3",
  factory: new ethers.Contract(config.PANCAKESWAP.FACTORY_V3, IUniswapV3Factory.abi, provider),
  quoter: new ethers.Contract(config.PANCAKESWAP.QUOTER_V3, IQuoter.abi, provider),
  router: new ethers.Contract(config.PANCAKESWAP.ROUTER_V3, ISwapRouter.abi, provider)
}

const IArbitrage = require('../artifacts/contracts/Arbitrage.sol/Arbitrage.json')
const arbitrage = new ethers.Contract(config.PROJECT_SETTINGS.ARBITRAGE_ADDRESS, IArbitrage.abi, provider)

module.exports = {
  provider,
  uniswap,
  pancakeswap,
  arbitrage
}
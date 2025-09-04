require('dotenv').config();
const { WebSocketProvider } = require("ethers");
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;
if (!ALCHEMY_API_KEY) {
  console.error("ALCHEMY_API_KEY is not set in .env! Bot will exit.");
  process.exit(1);
}

if (!process.env.PRIVATE_KEY || !/^0x[a-fA-F0-9]{64}$/.test(process.env.PRIVATE_KEY.trim())) {
  throw new Error("Invalid PRIVATE_KEY format in .env! Must be 0x followed by 64 hex chars.");
}

const ARBITRUM_RPC_URL = `wss://arb-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
const provider = new WebSocketProvider(ARBITRUM_RPC_URL); 



process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);

  // Do NOT use process.exit() here, let pm2 handle restarts, if it crashes websocket will reconnect automatically, if not, restart using pm2
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);

});



// For updating the bot, use the following commands in the terminal:
//git add .git commit -m "Your update message" git push origin main

// To pull the latest changes from the repository, use:
// cd ~/trading_bot_v3-master-REAL git pull


require("dotenv").config()
require('./helpers/server')
require("dotenv").config();

const Big = require('big.js')
const ethers = require("ethers")
const config = require('./config.json')
const { getTokenAndContract, getPoolContract, getPoolLiquidity, calculatePrice } = require('./helpers/helpers')
const { uniswap, pancakeswap, ramses, chronos, arbitrage } = require('./helpers/initialization')

const POOL_FEE = config.TOKENS.POOL_FEE
const UNITS = config.PROJECT_SETTINGS.PRICE_UNITS
const PRICE_DIFFERENCE = config.PROJECT_SETTINGS.PRICE_DIFFERENCE
const GAS_LIMIT = config.PROJECT_SETTINGS.GAS_LIMIT

let isExecuting = false

const pairs = config.PAIRS;
const dexes = [uniswap, pancakeswap];

let MIN_PROFIT = 0.001; // Default minimum profit in ETH

async function updateMinProfitThreshold(priceDifference) {
  const gasPrice = await getCurrentGasPrice();
  const estimatedGasCost = GAS_LIMIT * gasPrice / 1e18;
  // If price difference is small, require higher profit to avoid risk
  MIN_PROFIT = estimatedGasCost * (priceDifference < 1 ? 3 : 2);
  console.log(`Updated minimum profit threshold: ${MIN_PROFIT} ETH`);
}

const main = async () => {
  for (const pair of pairs) {
    const { FOR, AGAINST } = pair;
    const { token0, token1 } = await getTokenAndContract(FOR, AGAINST, provider);

    for (let i = 0; i < dexes.length; i++) {
      for (let j = 0; j < dexes.length; j++) {
        if (i === j) continue;
        const dexA = dexes[i];
        const dexB = dexes[j];

        const poolAAddress = await dexA.factory.getPool(token0.address, token1.address, POOL_FEE);
        if (poolAAddress === ethers.ZeroAddress) continue;
        const poolBAddress = await dexB.factory.getPool(token0.address, token1.address, POOL_FEE);
        if (poolBAddress === ethers.ZeroAddress) continue;

        const poolA = await getPoolContract(dexA, token0.address, token1.address, POOL_FEE, provider);
        const poolB = await getPoolContract(dexB, token0.address, token1.address, POOL_FEE, provider);

        console.log(`Monitoring ${token1.symbol}/${token0.symbol} on ${dexA.name} vs ${dexB.name}`);

        poolA.on('Swap', () => eventHandler(poolA, poolB, token0, token1, dexA, dexB));
        poolB.on('Swap', () => eventHandler(poolA, poolB, token0, token1, dexA, dexB));
      }
    }
  }
  console.log("Waiting for swap events on all pairs and DEX combinations...\n");
};

const eventHandler = async (_poolA, _poolB, _token0, _token1, _dexA, _dexB) => {
  if (!isExecuting) {
    isExecuting = true

    const priceDifference = await checkPrice([_poolA, _poolB], _token0, _token1, _dexA, _dexB)
    const exchangePath = await determineDirection(priceDifference, _dexA, _dexB)

    if (!exchangePath) {
      console.log(`No Arbitrage Currently Available\n`)
      console.log(`-----------------------------------------\n`)
      isExecuting = false
      return
    }

    const { isProfitable, amount } = await determineProfitability(exchangePath, _token0, _token1)

    if (!isProfitable) {
      console.log(`No Arbitrage Currently Available\n`)
      console.log(`-----------------------------------------\n`)
      isExecuting = false
      return
    }

    await executeTrade(exchangePath, _token0, _token1, amount)

    isExecuting = false

    console.log("\nWaiting for swap event...\n")
  }
}

const checkPrice = async (_pools, _token0, _token1, _dexA, _dexB) => {
  isExecuting = true

  console.log(`Swap Detected, Checking Price...\n`)

  const currentBlock = await provider.getBlockNumber()

  const priceA = await calculatePrice(_pools[0], _token0, _token1)
  const priceB = await calculatePrice(_pools[1], _token0, _token1)

  const fPriceA = Number(priceA).toFixed(UNITS)
  const fPriceB = Number(priceB).toFixed(UNITS)

  if (Number(fPriceB) === 0) {
    console.log(`${_dexB.name} price is zero, skipping calculation.\n`);
    return 0;
  }

  const priceDifference = (((fPriceA - fPriceB) / fPriceB) * 100).toFixed(2)

  console.log(`Current Block: ${currentBlock}`)
  console.log(`-----------------------------------------`)
  console.log(`${_dexA.name}     | ${_token1.symbol}/${_token0.symbol}\t | ${fPriceA}`)
  console.log(`${_dexB.name}     | ${_token1.symbol}/${_token0.symbol}\t | ${fPriceB}\n`)
  console.log(`Percentage Difference: ${priceDifference}%\n`)

  return priceDifference
}

const determineDirection = async (_priceDifference, _dexA, _dexB) => {
  console.log(`Determining Direction...\n`)

  if (_priceDifference >= PRICE_DIFFERENCE) {
    console.log(`Potential Arbitrage Direction:\n`)
    console.log(`Buy\t -->\t ${_dexA.name}`)
    console.log(`Sell\t -->\t ${_dexB.name}\n`)
    return [_dexA, _dexB]
  } else if (_priceDifference <= -(PRICE_DIFFERENCE)) {
    console.log(`Potential Arbitrage Direction:\n`)
    console.log(`Buy\t -->\t ${_dexB.name}`)
    console.log(`Sell\t -->\t ${_dexA.name}\n`)
    return [_dexB, _dexA]
  } else {
    return null
  }
}

async function findOptimalTradeSize(_exchangePath, _token0, _token1, liquidity) {
  // Try different percentages of liquidity
  const percentages = [0.0001, 0.0005, 0.001, 0.005, 0.01, 0.05, 0.1];
  let best = { profit: -Infinity, amount: 0 };

  for (const pct of percentages) {
    const minAmount = Big(liquidity[1]).mul(pct);
    const quoteExactOutputSingleParams = {
      tokenIn: _token0.address,
      tokenOut: _token1.address,
      fee: POOL_FEE,
      amount: BigInt(minAmount.round().toFixed(0)),
      sqrtPriceLimitX96: 0
    };

    try {
      const [token0Needed] = await _exchangePath[0].quoter.quoteExactOutputSingle.staticCall(quoteExactOutputSingleParams);
      const quoteExactInputSingleParams = {
        tokenIn: _token1.address,
        tokenOut: _token0.address,
        fee: POOL_FEE,
        amountIn: BigInt(minAmount.round().toFixed(0)),
        sqrtPriceLimitX96: 0
      };
      const [token0Returned] = await _exchangePath[1].quoter.quoteExactInputSingle.staticCall(quoteExactInputSingleParams);

      const amountIn = Number(ethers.formatUnits(token0Needed, _token0.decimals));
      const amountOut = Number(ethers.formatUnits(token0Returned, _token0.decimals));
      const estimatedGasCost = GAS_LIMIT * GAS_PRICE;
      const profit = amountOut - amountIn - estimatedGasCost;

      if (profit > best.profit) {
        best = { profit, amount: ethers.parseUnits(amountIn.toString(), _token0.decimals) };
      }
    } catch (err) {
      // Ignore failed simulations
      continue;
    }
  }
  return best;
}

const determineProfitability = async (_exchangePath, _token0, _token1) => {
  console.log(`Determining Profitability...\n`);
  try {
    const liquidity = await getPoolLiquidity(_exchangePath[0].factory, _token0, _token1, POOL_FEE, provider);
    const bestTrade = await findAdaptiveTradeSize(_exchangePath, _token0, _token1, liquidity);

    if (bestTrade.profit > MIN_PROFIT) {
      console.log(`Optimal trade profit: ${bestTrade.profit}, amount: ${ethers.formatUnits(bestTrade.amount, _token0.decimals)}`);
      return { isProfitable: true, amount: bestTrade.amount };
    } else {
      console.log(`Profit ${bestTrade.profit} below threshold ${MIN_PROFIT}, skipping.`);
      return { isProfitable: false, amount: 0 };
    }
  } catch (error) {
    console.log(error);
    return { isProfitable: false, amount: 0 };
  }
};

const executeTrade = async (_exchangePath, _token0, _token1, _amount) => {
  console.log(`Attempting Arbitrage...\n`)

  const routerPath = [
    await _exchangePath[0].router.getAddress(),
    await _exchangePath[1].router.getAddress()
  ]

  const tokenPath = [
    _token0.address,
    _token1.address
  ]

  const account = new ethers.Wallet(process.env.PRIVATE_KEY, provider)

  const tokenBalanceBefore = await _token0.contract.balanceOf(account.address)
  const ethBalanceBefore = await provider.getBalance(account.address)

  if (config.PROJECT_SETTINGS.isDeployed) {
    const transaction = await arbitrage.connect(account).executeTrade(
      routerPath,
      tokenPath,
      POOL_FEE,
      _amount
    )

    await transaction.wait(0)
  }

  console.log(`Trade Complete:\n`)

  const tokenBalanceAfter = await _token0.contract.balanceOf(account.address)
  const ethBalanceAfter = await provider.getBalance(account.address)

  const tokenBalanceDifference = tokenBalanceAfter - tokenBalanceBefore
  const ethBalanceDifference = ethBalanceBefore - ethBalanceAfter

  const data = {
    'ETH Balance Before': ethers.formatUnits(ethBalanceBefore, 18),
    'ETH Balance After': ethers.formatUnits(ethBalanceAfter, 18),
    'ETH Spent (gas)': ethers.formatUnits(ethBalanceDifference.toString(), 18),
    '-': {},
    'WETH Balance BEFORE': ethers.formatUnits(tokenBalanceBefore, _token0.decimals),
    'WETH Balance AFTER': ethers.formatUnits(tokenBalanceAfter, _token0.decimals),
    'WETH Gained/Lost': ethers.formatUnits(tokenBalanceDifference.toString(), _token0.decimals),
    '-': {},
    'Total Gained/Lost': `${ethers.formatUnits((tokenBalanceDifference - ethBalanceDifference).toString(), _token0.decimals)}`
  }

  console.table(data)
}

async function getCurrentGasPrice() {
  // ethers v6 does not have getGasPrice(), use send instead
  const gasPrice = await provider.send("eth_gasPrice", []);
  return Number(gasPrice); // returns in wei
}

let recentFailedTrades = 0;
let recentVolatility = 0.0;

function updateTradeStats(success, volatility) {
  if (!success) recentFailedTrades++;
  else recentFailedTrades = Math.max(0, recentFailedTrades - 1);
  recentVolatility = volatility;
}

async function findAdaptiveTradeSize(_exchangePath, _token0, _token1, liquidity) {
  let basePercentages = [0.0001, 0.0005, 0.001, 0.005, 0.01, 0.05, 0.1];
  if (recentFailedTrades > 2) basePercentages = [0.0001, 0.0005, 0.001]; // Be more conservative
  if (recentVolatility > 1.0) basePercentages = [0.01, 0.05, 0.1]; // Be more aggressive

  let best = { profit: -Infinity, amount: 0, details: {} };
  let gasPrice = await getCurrentGasPrice(); // Use real-time gas price

  for (const pct of basePercentages) {
    const minAmount = Big(liquidity[1]).mul(pct);
    const quoteExactOutputSingleParams = {
      tokenIn: _token0.address,
      tokenOut: _token1.address,
      fee: POOL_FEE,
      amount: BigInt(minAmount.round().toFixed(0)),
      sqrtPriceLimitX96: 0
    };

    try {
      const [token0Needed] = await _exchangePath[0].quoter.quoteExactOutputSingle.staticCall(quoteExactOutputSingleParams);
      const quoteExactInputSingleParams = {
        tokenIn: _token1.address,
        tokenOut: _token0.address,
        fee: POOL_FEE,
        amountIn: BigInt(minAmount.round().toFixed(0)),
        sqrtPriceLimitX96: 0
      };
      const [token0Returned] = await _exchangePath[1].quoter.quoteExactInputSingle.staticCall(quoteExactInputSingleParams);

      const amountIn = Number(ethers.formatUnits(token0Needed, _token0.decimals));
      const amountOut = Number(ethers.formatUnits(token0Returned, _token0.decimals));
      const estimatedGasCost = GAS_LIMIT * gasPrice / 1e18;
      const slippage = ((amountOut - amountIn) / amountIn) * 100;
      const profit = amountOut - amountIn - estimatedGasCost;

      // Log simulation
      console.log(`Simulated pct: ${pct}, amountIn: ${amountIn}, amountOut: ${amountOut}, profit: ${profit}, slippage: ${slippage}%`);

      // Update stats: treat as success if profit > 0
      updateTradeStats(profit > 0, recentVolatility);

      // Only consider trades with reasonable slippage (<1%)
      if (profit > best.profit && slippage > -1) {
        best = {
          profit,
          amount: ethers.parseUnits(amountIn.toString(), _token0.decimals),
          details: { pct, amountIn, amountOut, estimatedGasCost, slippage }
        };
      }
    } catch (err) {
      updateTradeStats(false, recentVolatility);
      continue;
    }
  }
  return best;
}

main()
require("dotenv").config()
require("@nomicfoundation/hardhat-toolbox")

const privateKey = process.env.PRIVATE_KEY || ""

module.exports = {
  solidity: "0.8.18",
networks: {
  localhost: {
    url: "http://127.0.0.1:8545"
  },
  mainnet: {
    url: `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
    accounts: [process.env.PRIVATE_KEY]
  },
}
}
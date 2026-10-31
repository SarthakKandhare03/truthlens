// Hardhat 3 configuration for the TruthRegistry contract.
//
// Networks:
//   - default (in-process, "edr-simulated"): used by `npm test`; a fresh chain every run.
//   - localhost: the long-running node started with `npm run node` (chain id 31337).
//     The web relayer talks to this one during development.
//   - amoy: Polygon's public PoS testnet (chain id 80002). Credentials come from .env.
//
// Secrets are never written here. `configVariable()` resolves values lazily from
// environment variables (loaded from .env by dotenv), so the Amoy settings are
// only required when you actually use `--network amoy`.
import "dotenv/config";
import hardhatToolboxMochaEthersPlugin from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { configVariable, defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatToolboxMochaEthersPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
      },
      // `--build-profile production` enables the optimizer for real deployments.
      production: {
        version: "0.8.28",
        settings: {
          optimizer: { enabled: true, runs: 200 },
        },
      },
    },
  },
  networks: {
    localhost: {
      type: "http",
      chainType: "l1",
      url: "http://127.0.0.1:8545",
    },
    amoy: {
      type: "http",
      chainType: "l1",
      chainId: 80002,
      url: configVariable("AMOY_RPC_URL"),
      accounts: [configVariable("DEPLOYER_PRIVATE_KEY")],
    },
  },
  // Lets `npx hardhat verify --network amoy <address>` publish the source on
  // amoy.polygonscan.com (Etherscan API v2 keys work across chains).
  verify: {
    etherscan: {
      apiKey: configVariable("ETHERSCAN_API_KEY"),
    },
  },
});

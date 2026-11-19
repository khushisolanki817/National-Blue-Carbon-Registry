const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

async function main() {
  // 1. Connect directly to running local Hardhat node
  const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
  const signer = await provider.getSigner(0);

  // 2. Read compiled contract artifact
  const artifactPath = path.join(
    __dirname,
    "../artifacts/contracts/BlueCarbonRegistry.sol/BlueCarbonRegistry.json"
  );

  if (!fs.existsSync(artifactPath)) {
    throw new Error("Artifacts not found. Please run: npx hardhat compile --config hardhat.config.cjs");
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

  // 3. Deploy contract using standard ethers ContractFactory
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
  const contract = await factory.deploy();
  await contract.waitForDeployment();

  const contractAddress = await contract.getAddress();

  console.log("--------------------------------------------------");
  console.log("BlueCarbonRegistry deployed successfully!");
  console.log("Contract Address:", contractAddress);
  console.log("Deployer Address:", signer.address);
  console.log("--------------------------------------------------");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
import { ethers } from "ethers"; 
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url"; 
import "dotenv/config"; // Import thư viện đọc file .env
import contractJson from "../artifacts/contracts/DataIntegrity.sol/DataIntegrity.json" with { type: "json" };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
    console.log("⏳ Đang kết nối thẳng tới mạng lưới Sepolia (Bypass Hardhat)...");

    // Lấy thông tin từ file .env thay vì ghi trực tiếp vào code
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

    const factory = new ethers.ContractFactory(contractJson.abi, contractJson.bytecode, wallet);
    const contract = await factory.deploy();
    await contract.waitForDeployment();

    const contractAddress = await contract.getAddress();
    console.log("🎉 THÀNH CÔNG! Smart Contract đã được đặt tại địa chỉ:", contractAddress);

    const envFilePath = path.join(__dirname, "../.env"); 
    let envContent = fs.readFileSync(envFilePath, "utf8");
    const regex = /CONTRACT_ADDRESS=.*/g;
    if (envContent.match(regex)) {
        envContent = envContent.replace(regex, `CONTRACT_ADDRESS=${contractAddress}`);
    } else {
        envContent += `\nCONTRACT_ADDRESS=${contractAddress}`;
    }
    fs.writeFileSync(envFilePath, envContent);
    console.log("✅ Đã tự động cập nhật địa chỉ mới vào file .env!");
}

main().catch((error) => {
    console.error("Lỗi triển khai:", error);
    process.exitCode = 1;
});
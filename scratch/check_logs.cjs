
const { ethers } = require("ethers");

async function check() {
    const provider = new ethers.JsonRpcProvider("https://arb1.arbitrum.io/rpc");
    const txHash = "0x5176d3c36805a9e29aca49f71cdeb5a10467f2c5ea58dcb0bab1efa6ee94b8d3";
    const receipt = await provider.getTransactionReceipt(txHash);
    
    console.log("--- Transaction Audit ---");
    const userOpEvent = receipt.logs.find(l => l.topics[0] === "0x49628e0a8f3484f326a27e7f918e762606798102e725ed3f391096b806246f88");
    const revertEvent = receipt.logs.find(l => l.topics[0] === "0x1c4f1da3af1cf604000000000000000000000000000000000000000000000000"); // UserOperationRevertReason

    if (userOpEvent) {
        const iface = new ethers.Interface(["event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)"]);
        const parsed = iface.parseLog(userOpEvent);
        console.log("\n[UserOperation]");
        console.log("Sender:", parsed.args.sender);
        console.log("Success:", parsed.args.success);
        console.log("Actual Gas Cost:", ethers.formatEther(parsed.args.actualGasCost), "ETH equivalent");
        
        if (!parsed.args.success && revertEvent) {
            const revIface = new ethers.Interface(["event UserOperationRevertReason(bytes32 indexed userOpHash, address indexed sender, uint256 nonce, bytes revertReason)"]);
            const revParsed = revIface.parseLog(revertEvent);
            console.log("Revert Reason (Hex):", revParsed.args.revertReason);
        }
    }

    receipt.logs.forEach((log, i) => {
        try {
            const entryPointInterface = new ethers.Interface([
                "event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)"
            ]);
            const parsed = entryPointInterface.parseLog(log);
            if (parsed && parsed.name === "UserOperationEvent") {
                console.log(`\n[UserOperation]`);
                console.log(`Sender: ${parsed.args.sender}`);
                console.log(`Success: ${parsed.args.success}`);
                console.log(`Actual Gas Cost: ${ethers.formatEther(parsed.args.actualGasCost)} ETH`);
            }
        } catch (e) {
            // Not an EntryPoint log
        }
        
        if (log.topics[0] === "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef") {
            console.log(`\n[Transfer Event Detected!]`);
            console.log(`Contract: ${log.address}`);
        }
    });
}

check();

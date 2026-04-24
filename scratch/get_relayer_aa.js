
async function getAAAddress() {
    const ownerAddress = "0x86CAbff342272f79fD776F549a12178aE9c8cE6F";
    const projectId = '3a913b51-6884-4638-bd23-fa0d728c7975';
    const clientKey = 'cizt9y8vB1VHrGU4lACTDkZg09rkMwYRDi5RcgZZ';
    
    const response = await fetch(`https://api.particle.network/server/rpc?chainId=42161&projectUuid=${projectId}&projectKey=${clientKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "particle_aa_getSmartAccount",
        params: [{
          name: "BICONOMY",
          version: "2.0.0",
          ownerAddress: ownerAddress
        }]
      })
    });

    const res = await response.json();
    console.log(JSON.stringify(res, null, 2));
}

getAAAddress();

import bmp = require('bitcoin-merkle-proof')
let encodeBitcoinTx = require('bitcoin-protocol').types.transaction.encode

interface RelayOptions {
  bitcoinRPC: any
  lotionLightClient: any
  pollIntervalSeconds?: number
  /**
   * Optionally specify an address to watch for deposits.
   *
   * If this isn't explicitly provided, it will be derived
   * from the signatory keys on the peg zone state.
   */
  depositAddress?: string
}

/**
 * Watches a Bitcoin full node for deposits to the signatory address.
 *
 * The Relay will poll its Bitcoin full node at regular
 * intervals to check for deposits to the signatory address.
 *
 * When it finds a Bitcoin deposit transaction, the Relay will first ensure
 * that the peg zone has received a chain of Bitcoin headers up to the block containing
 * the deposit transaction, then create and transmit a peg zone deposit transaction.
 *
 */
export class Relay {
  private bitcoinRPC: any
  private pollIntervalSeconds: number = 10
  private lotionLightClient: any
  private depositAddress?: string

  constructor(relayOpts: RelayOptions) {
    this.bitcoinRPC = relayOpts.bitcoinRPC
    if (relayOpts.pollIntervalSeconds) {
      this.pollIntervalSeconds = relayOpts.pollIntervalSeconds
    }
    this.lotionLightClient = relayOpts.lotionLightClient
    if (relayOpts.depositAddress) {
      this.depositAddress = relayOpts.depositAddress
    }
  }
  async start() {
    let rpc = this.bitcoinRPC
  }

  async relayHeaders(startHeight = 0) {
    let rpc = this.bitcoinRPC
    let lastBlockHash = await rpc.getBestBlockHash()
    let lastHeight = (await rpc.getBlockchainInfo()).headers
    let lastHeader = await rpc.getBlockHeader(lastBlockHash)
    let headers = [formatHeader(lastHeader)]
    while (lastHeight > startHeight + 1) {
      lastHeader = await rpc.getBlockHeader(lastHeader.previousblockhash)

      headers.push(formatHeader(lastHeader))
      lastHeight--
    }
    headers.reverse()

    await this.lotionLightClient.send({ type: 'headers', headers })
  }
  /**
   * Process all actions required by state updates on the peg zone or Bitcoin.
   *
   * Returns a promise which resolves when all necessary actions (such as relaying deposits) have been completed.
   */
  async step() {
    let rpc = this.bitcoinRPC
    let lc = this.lotionLightClient
    // Relay any headers not yet seen by the peg chain.
    let pegChainHeaders = await lc.state.bitcoin.headers
    let pegChainProcessedTxs = await lc.state.bitcoin.processedTxs
    let bestHeaderHeight = (await rpc.getBlockchainInfo()).headers
    if (bestHeaderHeight >= pegChainHeaders.length) {
      await this.relayHeaders(pegChainHeaders.length - 1)
    }
    // Check for Bitcoin deposits
    try {
      let allReceivedDepositTxs = await rpc.listTransactions('*', 1e9)
      let depositsToRelay = allReceivedDepositTxs.filter(
        tx =>
          tx.address === this.depositAddress &&
          tx.category === 'receive' &&
          !pegChainProcessedTxs[tx.txid]
      )
      let pegChainDepositTxs = []
      for (let i = 0; i < depositsToRelay.length; i++) {
        const VERBOSITY = 2
        let depositTx = depositsToRelay[i]
        let blockContainingDepositTx = await rpc.getBlock(
          depositTx.blockhash,
          VERBOSITY
        )
        let txHashesInBlock = blockContainingDepositTx.tx.map(tx => {
          return Buffer.from(tx.txid, 'hex').reverse()
        })
        let txHashesInBlockToIncludeInProof = [
          Buffer.from(depositTx.txid, 'hex').reverse()
        ]
        let proof = bmp.build({
          hashes: txHashesInBlock,
          include: txHashesInBlockToIncludeInProof
        })

        let pegChainDepositTx = {
          type: 'bitcoin',
          height: blockContainingDepositTx.height,
          proof,
          transactions: blockContainingDepositTx.tx
            .filter(tx => tx.txid === depositTx.txid)
            .map(tx => Buffer.from(tx.hex, 'hex'))
        }
      }
    } catch (e) {
      console.log(e)
    }
    // Get current weighted multisig address
  }
}

async function buildDepositProofForTxid(
  rpc: any,
  blockHash: string,
  txid: string,
  vout: number
) {
  try {
    console.log('getting tx..')
    console.log(txid)
    let tx = await rpc.getRawTransaction(txid, true)
    console.log(tx)
    return
  } catch (e) {
    console.log(e)
  }
}

function formatHeader(header) {
  return {
    height: Number(header.height),
    version: Number(header.version),
    prevHash: header.previousblockhash
      ? Buffer.from(header.previousblockhash, 'hex').reverse()
      : Buffer.alloc(32),
    merkleRoot: Buffer.from(header.merkleroot, 'hex').reverse(),
    timestamp: Number(header.time),
    bits: parseInt(header.bits, 16),
    nonce: Number(header.nonce)
  }
}

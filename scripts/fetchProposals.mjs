/**
 * One-time script to fetch all historical ArbitrumDAO proposals and write
 * them to src/data/proposals.json.
 *
 * Run with:
 *   VITE_RPC_URL=https://arb-mainnet.g.alchemy.com/v2/<key> node scripts/fetchProposals.mjs
 *
 * Re-run periodically (e.g. monthly) to keep history up to date.
 * The app then only queries recent blocks live via Alchemy at runtime.
 */

import { createPublicClient, http, parseAbiItem, toHex } from 'viem'
import { arbitrum } from 'viem/chains'
import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const RPC_URL = process.env.VITE_RPC_URL
if (!RPC_URL) {
  console.error('Set VITE_RPC_URL env var before running this script.')
  process.exit(1)
}

const CORE_GOVERNOR    = '0xf07DeD9dC292157749B6Fd268E37DF6EA38395B9'
const TREASURY_GOVERNOR = '0x789fC99093B09aD01C34DC7251D0C89ce743e5a4'
const GOVERNANCE_START_BLOCK = 75_000_000n
// Leave the last 5M blocks (~2 weeks) to be queried live by the app
const RECENT_BLOCKS = 5_000_000n
const CHUNK = 50_000n

const PROPOSAL_CREATED = parseAbiItem(
  'event ProposalCreated(uint256 proposalId, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 startBlock, uint256 endBlock, string description)',
)

const client = createPublicClient({ chain: arbitrum, transport: http(RPC_URL) })

async function fetchLogs(address, fromBlock, toBlock) {
  const chunks = []
  for (let f = fromBlock; f <= toBlock; f += CHUNK + 1n) {
    chunks.push({ from: f, to: f + CHUNK > toBlock ? toBlock : f + CHUNK })
  }

  console.log(`  ${address.slice(0, 10)}… — ${chunks.length} chunks (${fromBlock}→${toBlock})`)

  const all = []
  for (let i = 0; i < chunks.length; i += 20) {
    process.stdout.write(`\r  chunk batch ${Math.floor(i / 20) + 1}/${Math.ceil(chunks.length / 20)}   `)
    const results = await Promise.all(
      chunks.slice(i, i + 20).map(({ from, to }) =>
        client.getLogs({ address, event: PROPOSAL_CREATED, fromBlock: from, toBlock: to }),
      ),
    )
    all.push(...results.flat())
  }
  console.log()
  return all
}

function parseTitle(description) {
  const first = description.split('\n')[0].trim()
  return first.startsWith('#') ? first.replace(/^#+\s*/, '') : first
}

function parse(logs, governor) {
  return logs
    .filter((l) => l.args.proposalId !== undefined)
    .map((l) => ({
      proposalId: l.args.proposalId.toString(),
      proposer: l.args.proposer,
      title: parseTitle(l.args.description ?? ''),
      description: l.args.description ?? '',
      startBlock: l.args.startBlock.toString(),
      endBlock: l.args.endBlock.toString(),
      governor,
      governorAddress: governor === 'core' ? CORE_GOVERNOR : TREASURY_GOVERNOR,
    }))
}

async function main() {
  console.log('Fetching current block…')
  const currentBlock = await client.getBlockNumber()
  const toBlock = currentBlock - RECENT_BLOCKS

  if (toBlock <= GOVERNANCE_START_BLOCK) {
    console.log('Nothing to archive yet — recent window covers full history.')
    writeFileSync(resolve(__dirname, '../src/data/proposals.json'), JSON.stringify({ cutoffBlock: toBlock.toString(), proposals: [] }, null, 2))
    return
  }

  console.log(`Fetching blocks ${GOVERNANCE_START_BLOCK} → ${toBlock} (leaving last ${RECENT_BLOCKS} for live queries)`)

  console.log('\nCore Governor:')
  const coreLogs = await fetchLogs(CORE_GOVERNOR, GOVERNANCE_START_BLOCK, toBlock)

  console.log('Treasury Governor:')
  const treasuryLogs = await fetchLogs(TREASURY_GOVERNOR, GOVERNANCE_START_BLOCK, toBlock)

  const proposals = [
    ...parse(coreLogs, 'core'),
    ...parse(treasuryLogs, 'treasury'),
  ]
  proposals.sort((a, b) => Number(BigInt(b.startBlock) - BigInt(a.startBlock)))

  const out = {
    cutoffBlock: toBlock.toString(),
    proposals,
  }

  const outPath = resolve(__dirname, '../src/data/proposals.json')
  writeFileSync(outPath, JSON.stringify(out, null, 2))
  console.log(`\nWrote ${proposals.length} proposals to src/data/proposals.json (cutoff block: ${toBlock})`)
}

main().catch((e) => { console.error(e); process.exit(1) })

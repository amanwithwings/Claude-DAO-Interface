/**
 * One-time script to fetch all historical Arbitrum Security Council election
 * proposals and write them to src/data/elections.json.
 *
 * Run with:
 *   VITE_RPC_URL=https://arb-mainnet.g.alchemy.com/v2/<key> node scripts/fetchElections.mjs
 *
 * Re-run periodically (e.g. monthly) to keep history up to date.
 * The app then only queries recent blocks live at runtime.
 */

import { createPublicClient, http, parseAbiItem } from 'viem'
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

const NOMINEE_ELECTION_GOVERNOR = '0x8a1cDA8dee421cD06023470608605934c16A05a0'
const MEMBER_ELECTION_GOVERNOR  = '0x467923B9AE90BDB36BA88eCA11604D45F13b712C'
const ELECTIONS_START_BLOCK = 150_000_000n
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

function parseLogs(logs, phase, governorAddress) {
  return logs
    .filter((l) => l.args.proposalId !== undefined)
    .map((l) => ({
      proposalId: l.args.proposalId.toString(),
      proposer: l.args.proposer,
      title: parseTitle(l.args.description ?? ''),
      description: l.args.description ?? '',
      // L1 Ethereum block numbers — stored as voting window params, NOT for getLogs
      startBlock: l.args.startBlock.toString(),
      endBlock: l.args.endBlock.toString(),
      // L2 Arbitrum block where the ProposalCreated log was emitted — use this for getLogs
      emittedBlock: l.blockNumber.toString(),
      phase,
      governorAddress,
    }))
}

async function main() {
  console.log('Fetching current block…')
  const currentBlock = await client.getBlockNumber()
  const toBlock = currentBlock - RECENT_BLOCKS

  if (toBlock <= ELECTIONS_START_BLOCK) {
    console.log('Nothing to archive yet — recent window covers full history.')
    writeFileSync(
      resolve(__dirname, '../src/data/elections.json'),
      JSON.stringify({ cutoffBlock: toBlock.toString(), elections: [] }, null, 2),
    )
    return
  }

  console.log(`Fetching blocks ${ELECTIONS_START_BLOCK} → ${toBlock} (leaving last ${RECENT_BLOCKS} for live queries)`)

  console.log('\nNominee Election Governor:')
  const nomineeLogs = await fetchLogs(NOMINEE_ELECTION_GOVERNOR, ELECTIONS_START_BLOCK, toBlock)

  console.log('Member Election Governor:')
  const memberLogs  = await fetchLogs(MEMBER_ELECTION_GOVERNOR, ELECTIONS_START_BLOCK, toBlock)

  const nomineeElections = parseLogs(nomineeLogs, 'nominee', NOMINEE_ELECTION_GOVERNOR)
  const memberElections  = parseLogs(memberLogs,  'member',  MEMBER_ELECTION_GOVERNOR)

  // Assign electionIndex using emittedBlock (L2) — monotonically increasing, reliable ordering
  const sortedNominees = [...nomineeElections].sort((a, b) => Number(BigInt(a.emittedBlock) - BigInt(b.emittedBlock)))
  sortedNominees.forEach((e, i) => { e.electionIndex = i })

  // Match member elections to the closest preceding nominee election by emittedBlock
  const sortedMembers = [...memberElections].sort((a, b) => Number(BigInt(a.emittedBlock) - BigInt(b.emittedBlock)))
  sortedMembers.forEach((me) => {
    const filtered = sortedNominees.filter((ne) => BigInt(ne.emittedBlock) <= BigInt(me.emittedBlock))
    const match = filtered[filtered.length - 1]
    me.electionIndex = match ? match.electionIndex : 0
  })

  const elections = [...nomineeElections, ...memberElections]
  // Sort newest first by emittedBlock (L2), then nominee before member within same index
  elections.sort((a, b) => {
    if (b.electionIndex !== a.electionIndex) return b.electionIndex - a.electionIndex
    return a.phase === 'nominee' ? -1 : 1
  })

  const out = {
    cutoffBlock: toBlock.toString(),
    elections,
  }

  const outPath = resolve(__dirname, '../src/data/elections.json')
  writeFileSync(outPath, JSON.stringify(out, null, 2))
  console.log(`\nWrote ${elections.length} elections to src/data/elections.json (cutoff block: ${toBlock})`)
  console.log(`  ${nomineeElections.length} nominee phases, ${memberElections.length} member phases`)
}

main().catch((e) => { console.error(e); process.exit(1) })

import { createConfig, fallback, http, unstable_connector } from 'wagmi'
import { arbitrum } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'

export const config = createConfig({
  chains: [arbitrum],
  connectors: [injected()],
  transports: {
    // For contract reads (state, votes, etc.) — wallet RPC first, then free public nodes.
    // getLogs is handled separately in useProposals.ts via explicit client rotation.
    [arbitrum.id]: fallback([
      unstable_connector(injected),
      http('https://arbitrum.llamarpc.com'),
      http('https://arbitrum-one.publicnode.com'),
    ]),
  },
})

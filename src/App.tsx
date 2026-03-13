import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import Home from './pages/Home'
import ProposalDetail from './pages/ProposalDetail'

const router = createBrowserRouter([
  { path: '/', element: <Home /> },
  { path: '/proposal/:governor/:proposalId', element: <ProposalDetail /> },
])

export default function App() {
  return <RouterProvider router={router} />
}

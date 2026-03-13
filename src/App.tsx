import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import Home from './pages/Home'
import ProposalDetail from './pages/ProposalDetail'
import Elections from './pages/Elections'

const router = createBrowserRouter([
  { path: '/', element: <Home /> },
  { path: '/proposal/:governor/:proposalId', element: <ProposalDetail /> },
  { path: '/elections', element: <Elections /> },
])

export default function App() {
  return <RouterProvider router={router} />
}

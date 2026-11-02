import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

function RouterListener() {
  const navigate = useNavigate()
  useEffect(() => {
    function handleIPCResponse(e) {
      navigate(e.path)
    }

    return globalThis.api.receive('navigate', handleIPCResponse)
  }, [navigate])

  return null
}

export default RouterListener

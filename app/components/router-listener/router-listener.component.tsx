import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

function RouterListener() {
  const navigate = useNavigate()
  useEffect(() => {
    async function handleIPCResponse(e) {
      console.log('navigate event received', e)
      navigate(e.path)
    }

    return globalThis.electron.ipcRenderer.on('navigate', handleIPCResponse)
  }, [navigate])

  return null
}

export default RouterListener

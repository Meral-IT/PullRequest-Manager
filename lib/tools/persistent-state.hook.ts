import { useState, useEffect } from 'react'

export function usePersistentState<Type>(
  key: string,
  initialState: Type | (() => Type)
): [Type, React.Dispatch<React.SetStateAction<Type>>] {
  const prefixedKey = 'use-persistent-state-' + key
  // read key from local storage if not found use default value
  const [value, setValue] = useState<Type>(() => {
    const storedValue = localStorage.getItem(prefixedKey)
    if (storedValue === null) {
      if (typeof initialState === 'function') {
        return (initialState as () => Type)()
      } else {
        return initialState
      }
    } else {
      return JSON.parse(storedValue)
    }
  })
  // update local storage when value changes
  useEffect(() => {
    localStorage.setItem(prefixedKey, JSON.stringify(value))
  }, [value, prefixedKey])
  return [value, setValue]
}

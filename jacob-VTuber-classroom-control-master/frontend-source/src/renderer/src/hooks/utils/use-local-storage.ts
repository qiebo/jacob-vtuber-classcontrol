import { useEffect, useState } from 'react';

function parseStoredValue<T>(rawValue: string, initialValue: T): T {
  try {
    return JSON.parse(rawValue) as T;
  } catch (error) {
    if (typeof initialValue === 'string') {
      return rawValue as T;
    }

    if (typeof initialValue === 'number') {
      const numericValue = Number(rawValue);
      if (!Number.isNaN(numericValue)) {
        return numericValue as T;
      }
    }

    if (typeof initialValue === 'boolean') {
      if (rawValue === 'true' || rawValue === 'false') {
        return (rawValue === 'true') as T;
      }
    }

    console.error(`Error reading localStorage value:`, error);
    return initialValue;
  }
}

export function useLocalStorage<T>(
  key: string,
  initialValue: T,
  options?: {
    filter?: (value: T) => T
  },
) {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      const parsedValue = item ? parseStoredValue(item, initialValue) : initialValue;
      return parsedValue;
    } catch (error) {
      console.error(`Error reading localStorage key "${key}":`, error);
      return initialValue;
    }
  });

  const setValue = (value: T | ((val: T) => T)) => {
    try {
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      const filteredValue = options?.filter ? options.filter(valueToStore) : valueToStore;
      setStoredValue(valueToStore);
      window.localStorage.setItem(key, JSON.stringify(filteredValue));
      window.dispatchEvent(new StorageEvent('storage', {
        key,
        newValue: JSON.stringify(filteredValue),
      }));
    } catch (error) {
      console.error(`Error setting localStorage key "${key}":`, error);
    }
  };

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== key || event.newValue === null) {
        return;
      }
      setStoredValue(parseStoredValue(event.newValue, initialValue));
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [key, initialValue]);

  return [storedValue, setValue] as const;
}

import { useEffect } from 'react'
import { brand } from '../config/brand.js'

export function useDocumentTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} — ${brand.name}` : `${brand.name} — book a hairstylist`
  }, [title])
}

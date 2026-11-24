import { useRef, useState } from 'react'
import { uploadImage } from '../../services/storageService.js'
import { Button } from './Button.jsx'

/**
 * Uploads an image to Supabase Storage in the user's own folder and calls
 * onUploaded({ url, path }). Size/type are checked here and again by the
 * storage bucket rules.
 */
export function ImageUpload({ bucket, userId, onUploaded, label = 'Upload photo', multiple = false, variant = 'secondary' }) {
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const handleFiles = async (files) => {
    setError(null)
    setBusy(true)
    try {
      for (const file of Array.from(files)) {
        const result = await uploadImage(bucket, userId, file)
        await onUploaded(result)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple={multiple}
        className="sr-only"
        aria-label={label}
        onChange={(e) => e.target.files?.length && handleFiles(e.target.files)}
      />
      <Button variant={variant} size="sm" loading={busy} onClick={() => inputRef.current?.click()}>
        {busy ? 'Uploading…' : label}
      </Button>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  )
}

import { useEffect, useId, useRef } from 'react'
import { Button } from './Button.jsx'

/**
 * Accessible dialog built on the native <dialog> element (focus trapping and
 * Escape-to-close come from the browser).
 */
export function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  const ref = useRef(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  const widths = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl' }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
      className={`m-auto w-[calc(100%-2rem)] ${widths[size]} rounded-[var(--radius-panel)] border border-sand bg-paper p-0 text-ink shadow-2xl backdrop:bg-ink/40`}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-sand px-6 py-4">
            <h2 id={titleId} className="text-xl">
              {title}
            </h2>
            <button onClick={onClose} className="rounded-full p-1 text-stone hover:bg-sand-soft" aria-label="Close">
              ✕
            </button>
          </div>
          <div className="overflow-y-auto px-6 py-5">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-sand px-6 py-4">{footer}</div>}
        </div>
      )}
    </dialog>
  )
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Keep as is',
  tone = 'primary',
  busy = false,
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-ink-soft">{children}</div>
    </Modal>
  )
}

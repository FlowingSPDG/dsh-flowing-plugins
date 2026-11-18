/**
 * React state for the OpenCode Go quota chip: the three polled reads, the
 * Session read gated on the panel being open, and the panel's placement.
 *
 * Every poll owns one `AbortController` for its whole lifetime, so unmounting
 * the chip cancels an in-flight request instead of waiting out the 15-second
 * client timeout. A timed-out read still surfaces as an error while the poll
 * continues: only unmount aborts the controller.
 *
 * @module @local/opencode-go-quota/client/hooks
 */

import * as React from 'react'

import type { FreeSnapshot, SessionSnapshot, UsageSnapshot, WireError } from '../wire.ts'
import { errorMessage } from './format.ts'

/** Injected usage reader. */
export type ReadUsage = (force: boolean, signal?: AbortSignal) => Promise<UsageSnapshot>

/** Injected Session-usage reader. */
export type ReadSessionUsage = (sessionId: string, signal?: AbortSignal) => Promise<SessionSnapshot>

/** Injected free-model reader. */
export type ReadFree = (force: boolean, ack: boolean, signal?: AbortSignal) => Promise<FreeSnapshot>

/** How often a mounted chip asks for a fresh reading; the Host cache is shared. */
export const POLL_MS = 60_000

/** How often a mounted chip re-checks the free-model watcher. */
export const FREE_POLL_MS = 300_000

/** How often an open panel re-reads the Session while the agent is working. */
export const SESSION_POLL_MS = 10_000

/** A failed read as the panel renders it. */
function failureOf(error: unknown): WireError {
  return { code: 'request-failed', message: errorMessage(error) }
}

/**
 * Poll one reader on a fixed cadence until unmount.
 * @param read - the reader, called with the poll's abort signal.
 * @param intervalMs - delay between the end of one poll and the next.
 * @param fallback - snapshot to show when a poll throws.
 * @returns the latest snapshot, or null before the first answer.
 */
function usePolled<T>(
  read: (signal: AbortSignal) => Promise<T>,
  intervalMs: number,
  fallback: (error: unknown) => T,
): T | null {
  const [snapshot, setSnapshot] = React.useState<T | null>(null)
  React.useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | null = null
    const poll = (): void => {
      Promise.resolve()
        .then(() => read(controller.signal))
        .then((next) => {
          if (!controller.signal.aborted) setSnapshot(next)
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          setSnapshot(fallback(error))
        })
        .then(() => {
          if (!controller.signal.aborted) timer = setTimeout(poll, intervalMs)
        })
    }
    poll()
    return () => {
      controller.abort()
      if (timer !== null) clearTimeout(timer)
    }
  }, [read, intervalMs, fallback])
  return snapshot
}

/**
 * Ask the Host half for the usage, retrying once per poll interval so a
 * transient failure heals without a page reload.
 * @param readUsage - injected reader.
 * @returns the current snapshot.
 */
export function useUsage(readUsage: ReadUsage): UsageSnapshot | null {
  const fallback = React.useCallback(
    (error: unknown): UsageSnapshot => ({
      state: 'error',
      apiKeyEnv: 'OPENCODE_GO_API_KEY',
      fetchedAt: null,
      stale: false,
      usage: null,
      error: failureOf(error),
    }),
    [],
  )
  return usePolled(
    React.useCallback((signal: AbortSignal) => readUsage(false, signal), [readUsage]),
    POLL_MS,
    fallback,
  )
}

/**
 * Ask the Host half for the free-model watch on its own, slower cadence.
 * @param readFree - injected reader.
 * @returns the current snapshot.
 */
export function useFreeModels(readFree: ReadFree): FreeSnapshot | null {
  const fallback = React.useCallback(
    (error: unknown): FreeSnapshot => ({
      state: 'error',
      fetchedAt: null,
      stale: false,
      free: [],
      watched: [],
      history: [],
      newFree: [],
      error: failureOf(error),
    }),
    [],
  )
  return usePolled(
    React.useCallback((signal: AbortSignal) => readFree(false, false, signal), [readFree]),
    FREE_POLL_MS,
    fallback,
  )
}

/**
 * Read the current Session's attributed usage while the panel is open.
 * Polling covers live turns, tool logs, model switches, and compaction without
 * making the panel depend on any one transcript event.
 * @param readSessionUsage - injected Host reader.
 * @param sessionId - the mounted Session identity.
 * @param active - whether the panel is open.
 * @returns the latest host snapshot, or null before the first read.
 */
export function useSessionUsage(
  readSessionUsage: ReadSessionUsage,
  sessionId: string | undefined,
  active: boolean,
): SessionSnapshot | null {
  const [snapshot, setSnapshot] = React.useState<SessionSnapshot | null>(null)
  React.useEffect(() => {
    if (!active || sessionId === undefined || sessionId === '') {
      setSnapshot(null)
      return
    }
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | null = null
    const poll = (): void => {
      Promise.resolve()
        .then(() => readSessionUsage(sessionId, controller.signal))
        .then((next) => {
          if (!controller.signal.aborted) setSnapshot(next)
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          setSnapshot((previous) =>
            previous !== null && previous.state === 'ok'
              ? { ...previous, stale: true }
              : {
                  state: 'error',
                  provider: '',
                  generatedAt: Date.now(),
                  error: failureOf(error),
                },
          )
        })
        .then(() => {
          if (!controller.signal.aborted) timer = setTimeout(poll, SESSION_POLL_MS)
        })
    }
    poll()
    return () => {
      controller.abort()
      if (timer !== null) clearTimeout(timer)
    }
  }, [active, readSessionUsage, sessionId])
  return snapshot
}

/** The panel's fixed position, measured from the chip. */
export interface PanelPlacement {
  left: number
  width: number
  bottom: number
  maxHeight: number
}

/** The chip's open state, placement, and the refs the panel anchors to. */
export interface PanelState {
  open: boolean
  placement: PanelPlacement | null
  toggle: () => void
  anchorRef: React.RefObject<HTMLButtonElement | null>
  panelRef: React.RefObject<HTMLDivElement | null>
}

/**
 * The chip's open state plus its placement. The panel anchors above the chip
 * and closes on Escape or an outside press. It deliberately does not close on
 * scroll: agent replies and tool logs scroll the transcript while the user is
 * reading the panel, and that must not dismiss it.
 * @returns the panel state.
 */
export function usePanel(): PanelState {
  const anchorRef = React.useRef<HTMLButtonElement | null>(null)
  const panelRef = React.useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = React.useState(false)
  const [placement, setPlacement] = React.useState<PanelPlacement | null>(null)

  /** Re-anchor the fixed panel above the chip after a layout change. */
  const measure = React.useCallback(() => {
    const rect = anchorRef.current?.getBoundingClientRect()
    if (rect === undefined) return
    const width = Math.min(320, window.innerWidth - 24)
    const centered = rect.left + rect.width / 2 - width / 2
    const left = Math.min(Math.max(12, centered), Math.max(12, window.innerWidth - width - 12))
    setPlacement({
      left,
      width,
      bottom: window.innerHeight - rect.top + 8,
      maxHeight: Math.max(160, rect.top - 20),
    })
  }, [])

  const toggle = React.useCallback(() => {
    setOpen((wasOpen) => !wasOpen)
  }, [])

  React.useEffect(() => {
    if (!open) return
    measure()
    const onPointer = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node) {
        if (panelRef.current?.contains(target) === true) return
        if (anchorRef.current?.contains(target) === true) return
      }
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      // Consume the key before DSH's shortcut dispatcher can arm Esc-Esc
      // "stop turn"; closing the panel is the whole intended action.
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
    }
    const onLayout = (): void => {
      measure()
    }
    document.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onLayout)
    window.visualViewport?.addEventListener('resize', onLayout)
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(onLayout) : null
    const anchor = anchorRef.current
    if (observer !== null && anchor !== null) {
      const observed = new Set([
        anchor,
        anchor.parentElement,
        anchor.closest('[data-composer-card]'),
        anchor.closest('[data-composer-dock]'),
      ])
      for (const element of observed) {
        if (element !== null) observer.observe(element)
      }
    }
    return () => {
      document.removeEventListener('pointerdown', onPointer, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', onLayout)
      window.visualViewport?.removeEventListener('resize', onLayout)
      observer?.disconnect()
    }
  }, [measure, open])

  // Re-opening must never flash the previous anchor position.
  React.useEffect(() => {
    if (!open) setPlacement(null)
  }, [open])

  return { open, placement, toggle, anchorRef, panelRef }
}

"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronDown, MapPin, Coffee, Loader2, X, AlertTriangle, RotateCw, Edit2, DollarSign, Play, Pause, Square } from "lucide-react"
import { cn } from "@/lib/utils"
import { PLATFORMS, type Platform, type Trip, type LocationPoint, newTrip, grossOf, tripDateOf } from "./types"
import { PlatformAvatar, PlatformBadge } from "./platform-avatar"
import { isVoucherPlatform } from "./platform-meta"
import type { ShiftApi } from "./shift"
import {
  captureLocation,
  GpsAccuracyError,
  saveTempLocation,
  loadTempLocation,
  clearTempLocations,
  loadHeaderPlace,
  refreshHeaderPlace,
  type HeaderPlace,
} from "./geo"
import { MoneyInput } from "./money-input"
import { detectNewTolls, rateFor, formatTollNote, appendNote } from "./toll-detect"
import { loadShiftTolls, sumShiftTolls, SHIFT_TOLLS_EVENT, type ShiftToll } from "./shift-tolls"
import { fridayOfWeek } from "./ezpass-weekly"

/** Cuenta las estampas de peaje en una nota ("[Oct 29 · 14:35] … - $X" o "[14:35] …"). */
function countTollStamps(notes?: string): number {
  if (!notes) return 0
  return notes
    .split("|")
    .filter((p) => /\[(?:[A-Z][a-z]{2} \d{1,2} · )?\d{2}:\d{2}\]/.test(p) && (p.includes("- $") || /check E-ZPass/i.test(p)))
    .length
}

function LocationColumn({
  label,
  accent,
  loc,
  value,
  busy,
  disabled,
  lowAccuracy,
  onCapture,
  onManual,
  onClear,
  onConfirmManual,
}: {
  label: string
  accent: "green" | "sky"
  loc?: LocationPoint
  value: string
  busy: boolean
  disabled: boolean
  lowAccuracy?: { accuracy: number; errorMsg: string } | null
  onCapture: () => void
  onManual: (value: string) => void
  onClear: () => void
  onConfirmManual: () => void
}) {
  const border = accent === "green" ? "border-green-900/50" : "border-sky-900/50"
  const button = accent === "green" ? "bg-green-500 hover:bg-green-400" : "bg-sky-400 hover:bg-sky-300"

  return (
    <div className="flex min-w-0 flex-col gap-1">
      {/* Header con GPS badge */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold tracking-wide text-neutral-400">{label}</span>
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[9px] font-bold",
            loc
              ? "bg-green-500/15 text-green-400 border border-green-500/30"
              : lowAccuracy
              ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
              : "bg-neutral-800 text-neutral-400"
          )}
        >
          {busy
            ? "BUSCANDO..."
            : loc?.accuracy
            ? `GPS · ±${loc.accuracy}m`
            : "GPS"}
        </span>
      </div>

      {/* ESTADO 1: Confirmado (<= 50m) -> Banner Verde (Residencia) / Azul (Negocio) */}
      {loc ? (
        <div
          className={cn(
            "relative min-h-[118px] rounded-xl border p-3 transition-all",
            loc.banner === "blue"
              ? "border-sky-700/60 bg-sky-950/30 text-sky-100"
              : "border-emerald-700/60 bg-emerald-950/30 text-emerald-100"
          )}
        >
          <button
            type="button"
            aria-label={`Delete ${label.toLowerCase()}`}
            onClick={onClear}
            className="absolute right-1.5 top-1.5 rounded-lg bg-black/40 p-1 text-neutral-400 hover:text-white"
          >
            <X className="size-3.5" />
          </button>
          <div className="pr-5 text-[11px] leading-4">
            <div className="flex items-center gap-1.5 font-bold">
              <span>{loc.icon}</span>
              <span className={loc.banner === "blue" ? "text-sky-300" : "text-emerald-300"}>
                {loc.categoryLabel}
              </span>
              <span className="ml-auto rounded bg-black/40 px-1.5 py-0.5 text-[9px] font-mono text-neutral-300">
                ±{loc.accuracy}m
              </span>
            </div>
            {loc.businessName && (
              <div className="mt-0.5 truncate font-semibold text-white">{loc.businessName}</div>
            )}
            <div className="mt-0.5 line-clamp-2 text-neutral-300">{loc.address || value}</div>
            <div className="mt-1 text-[10px] font-mono text-neutral-400">{loc.time} · {loc.day}</div>
          </div>
        </div>
      ) : lowAccuracy ? (
        /* ESTADO 2: Tarjeta Amarilla (Baja precisión > 50m o Error de sensor) */
        <div className="rounded-xl border border-amber-500/60 bg-amber-950/30 p-2.5 text-amber-200">
          <div className="flex items-start gap-1.5">
            <AlertTriangle className="size-4 shrink-0 text-amber-400 mt-0.5" />
            <div className="flex-1 text-[11px] leading-tight">
              <div className="font-bold text-amber-300">Location not confirmed</div>
              <div className="mt-0.5 text-[10px] text-neutral-300">{lowAccuracy.errorMsg}</div>
            </div>
          </div>
          <div className="mt-2.5 flex gap-1.5">
            <button
              type="button"
              onClick={onCapture}
              disabled={busy}
              className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-amber-500 py-1.5 text-xs font-bold text-black hover:bg-amber-400 active:scale-[0.98] disabled:opacity-50"
            >
              <RotateCw className={cn("size-3", busy && "animate-spin")} />
              Reintentar GPS
            </button>
            <button
              type="button"
              onClick={onConfirmManual}
              className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-amber-500/50 bg-black/40 py-1.5 text-xs font-bold text-amber-300 hover:bg-amber-950/60 active:scale-[0.98]"
            >
              <Edit2 className="size-3" />
              Usar Manual
            </button>
          </div>
        </div>
      ) : (
        /* ESTADO 3: Entrada Manual Inicial */
        <>
          <input
            value={value}
            onChange={(e) => onManual(e.target.value)}
            placeholder={`Toca ${label.toLowerCase()}`}
            className={cn("rounded-lg border bg-neutral-950/60 px-2.5 py-1.5 text-[13px] text-white outline-none placeholder:text-neutral-500", border)}
          />
          <button
            type="button"
            onClick={onCapture}
            disabled={disabled}
            className={cn("flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-bold text-black active:scale-[0.98] disabled:cursor-wait disabled:opacity-60 transition", button)}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <MapPin className="size-4" />}
            {busy ? "BUSCANDO..." : `${label} NOW`}
          </button>
        </>
      )}
    </div>
  )
}

export function EntryScreen({
  onSave,
  trips = [],
  shift,
}: {
  onSave: (t: Trip) => void
  trips?: Trip[]
  shift: ShiftApi
}) {
  const [draft, setDraft] = useState<Trip>(() => {
    const initial = newTrip()
    // Cargar puntos GPS guardados temporalmente si existen
    const p = loadTempLocation("pickup")
    const d = loadTempLocation("dropoff")
    if (p) {
      initial.pickup = p.address
      initial.pickupLoc = p
    }
    if (d) {
      initial.dropoff = d.address
      initial.dropoffLoc = d
    }
    return initial
  })

  const [platformOpen, setPlatformOpen] = useState(false)
  const [onBreak, setOnBreak] = useState(false)
  const [capturing, setCapturing] = useState<null | "pickup" | "dropoff">(null)
  const [geoError, setGeoError] = useState<string | null>(null)
  const [lowAccuracy, setLowAccuracy] = useState<{ which: "pickup" | "dropoff"; accuracy: number; errorMsg: string } | null>(null)
  const [storageSaved, setStorageSaved] = useState(false)
  // Montos ocultos al abrir (privacidad ante el cliente): cada uno se muestra con un toque.
  const [showGross, setShowGross] = useState(false)
  const [showRegister, setShowRegister] = useState(false)
  // NOTES colapsada por defecto: así todo TODAY cabe sin scroll.
  const [notesOpen, setNotesOpen] = useState(false)
  // E-ZPass: peajes ya cobrados en este viaje (no duplicar) + aviso visual
  const tollHit = useRef<Set<string>>(new Set())
  const [tollFlash, setTollFlash] = useState<string | null>(null)
  // Diario de peajes del turno (pasadas entre trabajos): alimenta el
  // contador acumulativo de abajo (día/semana).
  const [diaryTolls, setDiaryTolls] = useState<ShiftToll[]>(() => loadShiftTolls())
  useEffect(() => {
    const refresh = () => setDiaryTolls(loadShiftTolls())
    window.addEventListener(SHIFT_TOLLS_EVENT, refresh)
    return () => window.removeEventListener(SHIFT_TOLLS_EVENT, refresh)
  }, [])

  const set = <K extends keyof Trip>(key: K, val: Trip[K]) =>
    setDraft((d) => ({ ...d, [key]: val }))

  async function capture(which: "pickup" | "dropoff") {
    setGeoError(null)
    setCapturing(which)
    try {
      const loc = await captureLocation()
      setDraft((d) => ({
        ...d,
        [which]: loc.address,
        [which === "pickup" ? "pickupLoc" : "dropoffLoc"]: loc,
      }))
      saveTempLocation(which, loc)
      if (which === "pickup") tollHit.current.clear() // viaje nuevo: detección E-ZPass armada
      if (lowAccuracy?.which === which) {
        setLowAccuracy(null)
      }
    } catch (e: any) {
      if (e instanceof GpsAccuracyError) {
        setLowAccuracy({ which, accuracy: e.accuracy, errorMsg: e.message })
      } else {
        setLowAccuracy({
          which,
          accuracy: 0,
          errorMsg: e instanceof Error ? e.message : "Couldn't get GPS",
        })
      }
    } finally {
      setCapturing(null)
    }
  }

  function clearLoc(which: "pickup" | "dropoff") {
    setDraft((d) => ({
      ...d,
      [which]: "",
      [which === "pickup" ? "pickupLoc" : "dropoffLoc"]: undefined,
    }))
    if (which === "pickup" && !shift.shiftActive) shift.stopGpsWatch()
    if (lowAccuracy?.which === which) {
      setLowAccuracy(null)
    }
    try {
      localStorage.removeItem(which === "pickup" ? "CURRENT_PICKUP" : "CURRENT_DROP_OFF")
    } catch {}
    if (which === "pickup") tollHit.current.clear()
  }

  function confirmManual(which: "pickup" | "dropoff") {
    if (lowAccuracy?.which === which) {
      setLowAccuracy(null)
    }
  }

  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    const updateNow = () => setNow(new Date())
    updateNow()
    const timer = window.setInterval(updateNow, 60_000)
    return () => window.clearInterval(timer)
  }, [])

  // E-ZPass automático: con el viaje activo (pickup capturado), cada fix del
  // GPS se cruza con las plazas 2026. Peaje nuevo → se suma a toll y se anota
  // "[Oct 29 · HH:MM] Estación - $X.XX" en notas (día y hora, Miguel
  // 2026-10-29). Si pasan varios peajes en el viaje, se suman todos.
  // No duplica la misma plaza en el mismo viaje.
  // El GPS continuo arranca con el viaje aunque no se haya presionado START.
  const gpsFix = shift.gps
  const tripActive = draft.pickupLoc != null
  useEffect(() => {
    if (tripActive) shift.ensureGpsWatch()
  }, [tripActive])
  useEffect(() => {
    if (!gpsFix || !tripActive) return
    const now = new Date()
    const fresh = detectNewTolls(gpsFix.lat, gpsFix.lng, gpsFix.heading ?? null, tollHit.current, now)
    if (fresh.length === 0) return
    fresh.forEach((p) => tollHit.current.add(p.name))
    setDraft((d) => {
      let toll = d.toll || 0
      let notes = d.notes || ""
      const labels: string[] = []
      for (const p of fresh) {
        const { text, amount } = formatTollNote(p, now)
        notes = appendNote(notes, text)
        if (amount != null) toll = Math.round((toll + amount) * 100) / 100
        labels.push(amount != null ? `${p.name} +$${amount.toFixed(2)}` : p.name)
      }
      return { ...d, toll, notes }
    })
    setTollFlash(`🛣️ ${fresh.map((p) => {
      const r = rateFor(p, now)
      return r != null ? `${p.name} +$${r.toFixed(2)}` : p.name
    }).join(" · ")}`)
    window.setTimeout(() => setTollFlash(null), 4000)
  }, [gpsFix, tripActive])

  // Ubicación actual (CALLE + CIUDAD) para la cabecera. Se muestra al instante
  // si hay una cacheada y se refresca en segundo plano sin bloquear la pantalla.
  const [place, setPlace] = useState<HeaderPlace | null>(null)

  useEffect(() => {
    let alive = true
    try {
      setPlace(loadHeaderPlace())
    } catch {}
    refreshHeaderPlace()
      .then((p) => {
        if (alive && p) setPlace(p)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  // La ubicación del header se refresca sola mientras la página está abierta
  // (cada 20 s, con posición fresca), para que diga dónde está mientras maneja.
  useEffect(() => {
    let alive = true
    let busy = false
    const poll = async () => {
      if (!alive || busy || document.hidden) return
      busy = true
      try {
        const p = await refreshHeaderPlace({ fresh: true })
        if (alive && p) {
          setPlace((prev) => (prev && prev.street === p.street && prev.city === p.city ? prev : p))
        }
      } catch {
        // sin GPS en este ciclo: se reintenta en el siguiente
      } finally {
        busy = false
      }
    }
    const id = window.setInterval(poll, 20_000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [])

  const greeting = now
    ? now.getHours() < 12
      ? "Good morning"
      : now.getHours() < 18
        ? "Good afternoon"
        : "Good evening"
    : "Good morning"

  function handleSave() {
    if (lowAccuracy) return

    // 1. Limpiar almacenamiento temporal de GPS (el viaje ya lo lleva dentro)
    clearTempLocations()

    // 2. Callback a la app principal: ella lo guarda en localStorage + IndexedDB
    onSave({ ...draft })

    // 3. Feedback STORAGE OK
    setStorageSaved(true)
    setTimeout(() => setStorageSaved(false), 2000)

    setDraft(newTrip())
    tollHit.current.clear()
    // Si el turno no está corriendo, el GPS era solo para peajes: apagarlo.
    if (!shift.shiftActive) shift.stopGpsWatch()
  }

  const today = new Date()
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`
  const todayTrips = trips.filter((trip) => tripDateOf(trip) === todayKey)
  const grossIncomeToday = todayTrips.reduce((total, trip) => total + grossOf(trip), 0)

  // Contador acumulativo de peajes (Miguel, 2026-10-29): TODO lo del día —
  // lo de los trabajos guardados + el viaje abierto + el diario del turno
  // (entre trabajos) — y la semana (la que cierra el viernes, como el bill
  // de E-ZPass). El total anual NO va aquí: vive en el Financial Statement.
  const weekFridayKey = fridayOfWeek(todayKey)
  const weekTrips = trips.filter((trip) => fridayOfWeek(tripDateOf(trip)) === weekFridayKey)
  const diaryToday = diaryTolls.filter((t) => t.date === todayKey)
  const diaryWeek = diaryTolls.filter((t) => fridayOfWeek(t.date) === weekFridayKey)
  const draftTollMoney = Number(draft.toll) || 0
  const tollsTodayMoney =
    Math.round(
      (todayTrips.reduce((s, t) => s + (Number(t.toll) || 0), 0) + sumShiftTolls(diaryToday) + draftTollMoney) * 100
    ) / 100
  const tollsWeekMoney =
    Math.round(
      (weekTrips.reduce((s, t) => s + (Number(t.toll) || 0), 0) + sumShiftTolls(diaryWeek) + draftTollMoney) * 100
    ) / 100
  const tollsTodayPasses =
    todayTrips.reduce((s, t) => s + countTollStamps(t.notes), 0) + diaryToday.length + countTollStamps(draft.notes)
  const lastDiaryPass = diaryToday.length > 0 ? diaryToday[diaryToday.length - 1] : null

  function toggleGross() {
    setShowGross((v) => !v)
  }

  function toggleRegister() {
    setShowRegister((v) => !v)
  }


  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-black text-white">
      {/* Header compacto */}
      <div className="shrink-0 px-4 pt-2 pb-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-lime-500 text-black text-xs font-black">C</div>
            <span className="text-base font-bold">Copiloto <span className="text-lime-400">V8</span></span>
          </div>
          <div className="flex items-center gap-1 rounded-full border border-lime-500/40 bg-lime-500/10 px-2 py-0.5 text-[10px] font-semibold text-lime-400">
            <span className="size-1.5 rounded-full bg-lime-400" />
            {place ? "GPS" : "..."}
          </div>
        </div>
        <p className="mt-1 text-xl font-bold">{greeting}</p>
        <p className="flex items-center gap-1 text-sm text-neutral-400" suppressHydrationWarning>
          <MapPin className="size-3.5 text-lime-400" />
          {place ? (
            <span className="truncate">
              {place.neighborhood && <span className="font-semibold text-neutral-200">{place.neighborhood}</span>}
              {place.neighborhood && (place.street || place.city) && " · "}
              <span className="font-semibold text-neutral-200">{place.street || place.city}</span>
              {place.street && place.city && <span>, {place.city}</span>}
            </span>
          ) : (
            <span className="text-neutral-600">Looking up location…</span>
          )}
        </p>
        <p className="text-sm font-semibold text-neutral-200" suppressHydrationWarning>
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
        </p>
      </div>

      {/* Shift + Platform en una fila */}
      <div className="mx-4 mb-2 grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-2.5">
          <p className="text-[9px] font-bold uppercase text-neutral-500">Shift</p>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-xs font-bold">{!shift.shiftActive ? "OFF" : shift.isOnBreak ? "BREAK" : "ON"}</span>
            {!shift.shiftActive ? (
              <button type="button" onClick={shift.onStart} className="rounded-lg bg-lime-400 px-3 py-1.5 text-xs font-bold text-black">START</button>
            ) : (
              <button type="button" onClick={shift.onEnd} className="rounded-lg border border-rose-500/40 px-2 py-1 text-[10px] font-semibold text-rose-400">END</button>
            )}
          </div>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-2.5">
          <p className="text-[9px] font-bold uppercase text-neutral-500">Platform</p>
          <button type="button" onClick={() => setPlatformOpen((o) => !o)} className="mt-1 flex w-full items-center justify-between text-sm font-bold">
            {draft.platform} <ChevronDown className="size-3.5 text-neutral-500" />
          </button>
        </div>
      </div>
      {platformOpen && (
        <div className="mx-4 mb-2 max-h-32 overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-900">
          {PLATFORMS.map((p) => (
            <button key={p} type="button" onClick={() => { setDraft((d) => ({ ...d, platform: p, isVoucher: isVoucherPlatform(p) })); setPlatformOpen(false); }} className={cn("flex w-full items-center px-3 py-2 text-left text-sm", p === draft.platform && "bg-lime-500/10 text-lime-400")}>{p}</button>
          ))}
        </div>
      )}

      {/* Money - campos grandes y claros */}
      <div className="mx-4 mb-2 rounded-xl border border-neutral-800 bg-neutral-950 p-3">
        <p className="mb-2 text-[9px] font-bold uppercase text-neutral-500">Earnings</p>
        <div className="grid grid-cols-5 gap-2">
          {[
            { label: "Fare", key: "earnings", color: "text-lime-400" },
            { label: "Tips", key: "tips", color: "text-lime-400" },
            { label: "Tolls", key: "toll", color: "text-amber-400" },
            { label: "Fee", key: "platformFee", color: "text-rose-400" },
            { label: "Extra", key: "extraCash", color: "text-lime-400" },
          ].map((f) => (
            <div key={f.key}>
              <p className="mb-1 text-center text-[10px] font-semibold text-neutral-400">{f.label}</p>
              <input
                type="number"
                step="0.01"
                inputMode="decimal"
                value={(draft as any)[f.key] || ""}
                onChange={(e) => set(f.key as any, Number(e.target.value) || 0)}
                className={cn("w-full rounded-lg border border-neutral-700 bg-black py-2 text-center text-base font-bold outline-none focus:border-lime-500", f.color)}
                placeholder="0"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Locations - inputs claros */}
      <div className="mx-4 mb-2 flex-1 rounded-xl border border-neutral-800 bg-neutral-950 p-3">
        <p className="mb-2 text-[9px] font-bold uppercase text-neutral-500">Locations</p>
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              value={draft.pickup}
              onChange={(e) => set("pickup", e.target.value)}
              placeholder="Pickup address"
              className="flex-1 rounded-lg border border-neutral-700 bg-black px-3 py-2.5 text-sm outline-none focus:border-lime-500"
            />
            <button type="button" onClick={() => capture("pickup")} disabled={capturing !== null} className="shrink-0 rounded-lg bg-lime-400 px-3 py-2.5 text-xs font-bold text-black disabled:opacity-50">
              {capturing === "pickup" ? "..." : "GPS"}
            </button>
          </div>
          <div className="flex gap-2">
            <input
              value={draft.dropoff}
              onChange={(e) => set("dropoff", e.target.value)}
              placeholder="Dropoff address"
              className="flex-1 rounded-lg border border-neutral-700 bg-black px-3 py-2.5 text-sm outline-none focus:border-cyan-500"
            />
            <button type="button" onClick={() => capture("dropoff")} disabled={capturing !== null} className="shrink-0 rounded-lg bg-cyan-400 px-3 py-2.5 text-xs font-bold text-black disabled:opacity-50">
              {capturing === "dropoff" ? "..." : "GPS"}
            </button>
          </div>
        </div>
      </div>

      {/* Save grande */}
      <div className="mx-4 mb-3">
        <button type="button" onClick={handleSave} className="w-full rounded-xl bg-amber-400 py-3.5 text-base font-bold text-black">
          Save trip
        </button>
      </div>

      {tollFlash && <p className="mx-4 mb-2 rounded-lg bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300">{tollFlash}</p>}
      {geoError && <p className="mx-4 mb-2 rounded-lg bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300">{geoError}</p>}
    </div>
  )
}

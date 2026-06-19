'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Save, Plus, Info, RefreshCw, Link2, AlertCircle } from 'lucide-react'
import { matchesQuery } from '@/lib/search'
import { fetchAllFromView } from '@/lib/hooks/use-fetch-all'
import Link from 'next/link'

interface ProveedorConfig {
  id: string
  nombre: string
  frecuencia_dias: number
  margen_costo: number | null
  notas: string | null
  tipo: 'global' | 'sucursal'
  lead_time_dias: number
  dia_pedido: number | null
  dux_proveedor_id: number | null
}

interface RowState {
  frecuencia_dias: string
  margen_costo: string
  notas: string
  tipo: 'global' | 'sucursal'
  lead_time_dias: string
  dia_pedido: string  // '1'–'7' or '' for none
  dux_proveedor_id: string  // numeric string or '' for none
  dirty: boolean
  saving: boolean
  saved: boolean
}

function frecuenciaLabel(dias: number): string {
  if (dias <= 3)  return 'Casi diario'
  if (dias <= 7)  return 'Semanal'
  if (dias <= 15) return 'Quincenal'
  if (dias <= 31) return 'Mensual'
  if (dias <= 60) return 'Bimestral'
  return `${dias} días`
}

export default function ProveedoresConfigPage() {
  const [configs, setConfigs] = useState<ProveedorConfig[]>([])
  const [nombres, setNombres] = useState<string[]>([])
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [newNombre, setNewNombre] = useState('')
  const [savingNew, setSavingNew] = useState(false)

  // Matching panel state
  const [sinConfig, setSinConfig] = useState<string[]>([])
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)
  // For aliasing: nombre_dux → config_id selected
  const [aliasSelects, setAliasSelects] = useState<Record<string, string>>({})
  const [savingAlias, setSavingAlias] = useState<Record<string, boolean>>({})

  const loadAll = useCallback(async () => {
    setLoading(true)
    // productos tiene >3000 filas: sin paginar, la lista de proveedores quedaba incompleta
    const [configRes, prodRows, sinConfigRes] = await Promise.all([
      supabase.from('proveedores_config').select('*').order('nombre'),
      fetchAllFromView<{ proveedor_nombre: string | null }>('productos', {
        select: 'proveedor_nombre',
        filters: [{ column: 'proveedor_nombre', operator: 'not.is', value: null }],
      }),
      supabase.from('v_proveedores_sin_config').select('proveedor_nombre'),
    ])
    const cfgs = (configRes.data ?? []) as ProveedorConfig[]
    setConfigs(cfgs)

    const allNombres = [...new Set(
      prodRows.map(p => p.proveedor_nombre).filter(Boolean) as string[]
    )].sort((a, b) => a.localeCompare(b, 'es'))
    setNombres(allNombres)

    setSinConfig(
      (sinConfigRes.data ?? [])
        .map((r: { proveedor_nombre: string }) => r.proveedor_nombre)
        .filter(Boolean) as string[]
    )

    const initial: Record<string, RowState> = {}
    for (const n of allNombres) {
      const cfg = cfgs.find(c => c.nombre === n)
      initial[n] = {
        frecuencia_dias: String(cfg?.frecuencia_dias ?? 30),
        margen_costo: cfg?.margen_costo != null ? String(Math.round(cfg.margen_costo * 100)) : '',
        notas: cfg?.notas ?? '',
        tipo: cfg?.tipo ?? 'global',
        lead_time_dias: String(cfg?.lead_time_dias ?? 3),
        dia_pedido: cfg?.dia_pedido != null ? String(cfg.dia_pedido) : '',
        dux_proveedor_id: cfg?.dux_proveedor_id != null ? String(cfg.dux_proveedor_id) : '',
        dirty: false,
        saving: false,
        saved: false,
      }
    }
    setRows(initial)
    setLoading(false)
  }, [])

  // Fetch + populate rows when loadAll changes (mount + manual refresh).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadAll() }, [loadAll])

  function setField(nombre: string, field: keyof Omit<RowState, 'dirty' | 'saving' | 'saved'>, value: string) {
    setRows(prev => ({ ...prev, [nombre]: { ...prev[nombre], [field]: value, dirty: true, saved: false } }))
  }

  function setFieldAny(nombre: string, field: string, value: string) {
    setRows(prev => ({ ...prev, [nombre]: { ...prev[nombre], [field]: value, dirty: true, saved: false } }))
  }

  function setTipo(nombre: string, value: 'global' | 'sucursal') {
    setRows(prev => ({ ...prev, [nombre]: { ...prev[nombre], tipo: value, dirty: true, saved: false } }))
  }

  async function saveRow(nombre: string) {
    const row = rows[nombre]
    if (!row) return
    const frecuencia = parseInt(row.frecuencia_dias) || 30
    const margen = row.margen_costo !== '' ? parseFloat(row.margen_costo) / 100 : null

    setRows(prev => ({ ...prev, [nombre]: { ...prev[nombre], saving: true } }))

    const leadTimeVal = Math.max(1, parseInt(row.lead_time_dias) || 3)
    const diaPedidoVal = row.dia_pedido !== '' ? parseInt(row.dia_pedido) : null
    const duxProveedorIdVal = row.dux_proveedor_id !== '' ? parseInt(row.dux_proveedor_id) : null

    const existing = configs.find(c => c.nombre === nombre)
    if (existing) {
      await supabase.from('proveedores_config').update({
        frecuencia_dias: frecuencia,
        margen_costo: margen,
        notas: row.notas || null,
        tipo: row.tipo,
        lead_time_dias: leadTimeVal,
        dia_pedido: diaPedidoVal,
        dux_proveedor_id: duxProveedorIdVal,
        updated_at: new Date().toISOString(),
      }).eq('id', existing.id)
    } else {
      const { data } = await supabase.from('proveedores_config').insert({
        nombre,
        frecuencia_dias: frecuencia,
        margen_costo: margen,
        notas: row.notas || null,
        tipo: row.tipo,
        lead_time_dias: leadTimeVal,
        dia_pedido: diaPedidoVal,
        dux_proveedor_id: duxProveedorIdVal,
      }).select('*').single()
      if (data) setConfigs(prev => [...prev, data as ProveedorConfig])
    }

    setRows(prev => ({ ...prev, [nombre]: { ...prev[nombre], saving: false, dirty: false, saved: true } }))
    setTimeout(() => setRows(prev => ({ ...prev, [nombre]: { ...prev[nombre], saved: false } })), 2500)
  }

  async function addNewProveedor() {
    const nombre = newNombre.trim()
    if (!nombre) return
    setSavingNew(true)
    const { data } = await supabase.from('proveedores_config').insert({
      nombre,
      frecuencia_dias: 30,
      margen_costo: null,
      tipo: 'global',
      lead_time_dias: 3,
    }).select('*').single()
    if (data) {
      setConfigs(prev => [...prev, data as ProveedorConfig])
      setNombres(prev => [...prev, nombre].sort((a, b) => a.localeCompare(b, 'es')))
      setRows(prev => ({
        ...prev,
        [nombre]: {
          frecuencia_dias: '30', margen_costo: '', notas: '', tipo: 'global',
          lead_time_dias: '3', dia_pedido: '', dux_proveedor_id: '',
          dirty: false, saving: false, saved: false,
        },
      }))
    }
    setNewNombre('')
    setShowNew(false)
    setSavingNew(false)
  }

  async function handleAutoSync() {
    setSyncing(true)
    setSyncResult(null)
    const { data, error } = await supabase.rpc('auto_sync_proveedores_config')
    if (error) {
      setSyncResult('Error al sincronizar')
    } else {
      const n = data as number
      setSyncResult(n > 0 ? `✓ ${n} proveedor${n > 1 ? 'es' : ''} nuevo${n > 1 ? 's' : ''} agregado${n > 1 ? 's' : ''}` : '✓ Sin novedades')
      await loadAll()
    }
    setSyncing(false)
    setTimeout(() => setSyncResult(null), 4000)
  }

  async function handleCreateAlias(nombreDux: string, configId: string) {
    setSavingAlias(prev => ({ ...prev, [nombreDux]: true }))
    await supabase.from('proveedores_aliases').insert({
      config_id: configId,
      nombre_dux: nombreDux,
    })
    setSavingAlias(prev => ({ ...prev, [nombreDux]: false }))
    await loadAll()
  }

  async function handleCrearNuevo(nombreDux: string) {
    setSavingAlias(prev => ({ ...prev, [nombreDux]: true }))
    await supabase.from('proveedores_config').insert({
      nombre: nombreDux,
      frecuencia_dias: 30,
      tipo: 'global',
    })
    setSavingAlias(prev => ({ ...prev, [nombreDux]: false }))
    await loadAll()
  }

  const configSet = useMemo(() => new Set(configs.map(c => c.nombre)), [configs])

  const filtered = useMemo(() =>
    search ? nombres.filter(n => matchesQuery(search, n)) : nombres,
    [nombres, search]
  )

  const totalValorizados = configs.filter(c => c.margen_costo != null).length
  const configurados = configs.length
  const porSucursal = configs.filter(c => c.tipo === 'sucursal').length

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/compras" className="text-zinc-400 hover:text-zinc-700 transition-colors">
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">Configuración de Proveedores</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Frecuencia, margen y tipo de pedido por proveedor</p>
        </div>
      </div>

      {/* Info banner */}
      <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 flex gap-3 text-sm text-blue-800">
        <Info size={16} className="shrink-0 mt-0.5 text-blue-500" />
        <div className="space-y-1">
          <p><strong>Frecuencia</strong> — ¿Cada cuántos días hacés el pedido? Determina el horizonte de la sugerencia.</p>
          <p><strong>Margen %</strong> — Markup sobre precio venta para estimar costo cuando Dux no lo tiene sincronizado.</p>
          <p><strong>Plazo de entrega</strong> — Días entre el pedido y la recepción. Se usa para garantizar cobertura mínima durante el tiempo de espera.</p>
          <p><strong>Día pedido</strong> — Día de la semana en que hacés el pedido. Genera una alerta en el Dashboard de Compras los días que corresponda.</p>
          <p><strong>Tipo de pedido</strong> — <strong>Global</strong>: stock total de la cadena. <strong>Por sucursal</strong>: sugerencia independiente para SOHO 1 y SOHO 2.</p>
        </div>
      </div>

      {/* Stats + Sync button */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex gap-4 text-sm">
          <span className="text-zinc-500">{nombres.length} proveedores en catálogo</span>
          <span className="text-zinc-400">·</span>
          <span className="text-zinc-500">{configurados} configurados</span>
          <span className="text-zinc-400">·</span>
          <span className="text-zinc-500">{totalValorizados} con margen</span>
          <span className="text-zinc-400">·</span>
          <span className="text-zinc-500">{porSucursal} por sucursal</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {syncResult && <span className="text-xs text-green-600">{syncResult}</span>}
          <Button
            size="sm"
            variant="outline"
            onClick={handleAutoSync}
            disabled={syncing}
            className="flex items-center gap-1.5"
          >
            <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Sincronizando...' : 'Sincronizar desde Dux'}
          </Button>
        </div>
      </div>

      {/* Panel: proveedores de Dux sin config */}
      {sinConfig.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-amber-200">
            <AlertCircle size={15} className="text-amber-600 shrink-0" />
            <span className="text-sm font-medium text-amber-800">
              {sinConfig.length} proveedor{sinConfig.length > 1 ? 'es' : ''} de Dux sin configurar
            </span>
            <span className="text-xs text-amber-600 ml-1">— podría ser un nombre diferente al que ya tenés guardado</span>
          </div>
          <div className="divide-y divide-amber-100">
            {sinConfig.map(nombreDux => (
              <div key={nombreDux} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                <span className="flex-1 font-medium text-zinc-700">{nombreDux}</span>
                {/* Asociar a config existente */}
                <div className="flex items-center gap-2">
                  <select
                    value={aliasSelects[nombreDux] ?? ''}
                    onChange={e => setAliasSelects(prev => ({ ...prev, [nombreDux]: e.target.value }))}
                    className="h-7 text-xs border border-input rounded-md px-2 bg-white text-zinc-700 focus:outline-none"
                  >
                    <option value="">Asociar a...</option>
                    {configs.map(c => (
                      <option key={c.id} value={c.id}>{c.nombre}</option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!aliasSelects[nombreDux] || savingAlias[nombreDux]}
                    onClick={() => handleCreateAlias(nombreDux, aliasSelects[nombreDux])}
                    className="h-7 text-xs flex items-center gap-1"
                  >
                    <Link2 size={11} />
                    Asociar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={savingAlias[nombreDux]}
                    onClick={() => handleCrearNuevo(nombreDux)}
                    className="h-7 text-xs text-zinc-500 hover:text-zinc-800"
                  >
                    + Crear nuevo
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search + Add */}
      <div className="flex gap-2">
        <Input
          placeholder="Buscar proveedor..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-72"
        />
        <Button size="sm" variant="outline" onClick={() => setShowNew(true)}>
          <Plus size={14} className="mr-1" />
          Agregar proveedor
        </Button>
      </div>

      {/* New provider form */}
      {showNew && (
        <div className="rounded-lg border bg-zinc-50 p-4 flex items-end gap-3">
          <div className="flex-1">
            <label className="text-xs text-zinc-500 mb-1 block">Nombre del proveedor</label>
            <Input
              autoFocus
              value={newNombre}
              onChange={e => setNewNombre(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addNewProveedor()}
              placeholder="Ej: Karen Pavioto"
            />
          </div>
          <Button size="sm" onClick={addNewProveedor} disabled={!newNombre.trim() || savingNew}>
            {savingNew ? 'Guardando...' : 'Crear'}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowNew(false)}>Cancelar</Button>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="text-zinc-400 text-sm py-8 text-center">Cargando...</div>
      ) : (
        <div className="rounded-lg border overflow-hidden bg-white">
          <div className="grid grid-cols-[1fr_140px_100px_100px_80px_130px_1fr_100px] gap-0 bg-zinc-50 border-b text-xs font-semibold text-zinc-500 uppercase tracking-wide">
            <div className="px-4 py-2.5">Proveedor</div>
            <div className="px-3 py-2.5">Tipo pedido</div>
            <div className="px-3 py-2.5">Frecuencia</div>
            <div className="px-3 py-2.5">Margen %</div>
            <div className="px-3 py-2.5">Plazo entrega</div>
            <div className="px-3 py-2.5">Día pedido</div>
            <div className="px-3 py-2.5 text-indigo-700" title="ID del proveedor en Dux para registrar compras">ID Dux</div>
            <div className="px-3 py-2.5">Notas</div>
            <div className="px-3 py-2.5"></div>
          </div>
          {filtered.length === 0 ? (
            <div className="text-zinc-400 text-sm py-8 text-center">Sin resultados</div>
          ) : (
            filtered.map(nombre => {
              const row = rows[nombre]
              const isConfigured = configSet.has(nombre)
              if (!row) return null
              const frecNum = parseInt(row.frecuencia_dias) || 30
              return (
                <div
                  key={nombre}
                  className="grid grid-cols-[1fr_140px_100px_100px_80px_130px_1fr_100px] gap-0 border-b last:border-b-0 items-center hover:bg-zinc-50 transition-colors"
                >
                  {/* Nombre */}
                  <div className="px-4 py-3">
                    <p className="text-sm font-medium text-zinc-800">{nombre}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {isConfigured
                        ? <Badge className="text-[10px] bg-green-50 text-green-700 border-green-200 px-1.5 py-0">{frecuenciaLabel(frecNum)}</Badge>
                        : <Badge variant="outline" className="text-[10px] text-zinc-400 px-1.5 py-0">Sin configurar</Badge>
                      }
                    </div>
                  </div>
                  {/* Tipo */}
                  <div className="px-3 py-3">
                    <div className="flex rounded-md overflow-hidden border border-input text-xs">
                      <button
                        type="button"
                        onClick={() => setTipo(nombre, 'global')}
                        className={`flex-1 py-1.5 text-center transition-colors ${
                          row.tipo === 'global'
                            ? 'bg-zinc-900 text-white font-medium'
                            : 'bg-white text-zinc-500 hover:bg-zinc-50'
                        }`}
                      >
                        Global
                      </button>
                      <button
                        type="button"
                        onClick={() => setTipo(nombre, 'sucursal')}
                        className={`flex-1 py-1.5 text-center transition-colors border-l border-input ${
                          row.tipo === 'sucursal'
                            ? 'bg-zinc-900 text-white font-medium'
                            : 'bg-white text-zinc-500 hover:bg-zinc-50'
                        }`}
                      >
                        Sucursal
                      </button>
                    </div>
                  </div>
                  {/* Frecuencia */}
                  <div className="px-3 py-3">
                    <Input
                      type="number"
                      min={1}
                      max={365}
                      value={row.frecuencia_dias}
                      onChange={e => setField(nombre, 'frecuencia_dias', e.target.value)}
                      className="h-8 text-sm w-full"
                      placeholder="30"
                    />
                  </div>
                  {/* Margen */}
                  <div className="px-3 py-3">
                    <div className="relative">
                      <Input
                        type="number"
                        min={0}
                        max={999}
                        step={1}
                        value={row.margen_costo}
                        onChange={e => setField(nombre, 'margen_costo', e.target.value)}
                        className="h-8 text-sm w-full pr-6"
                        placeholder="40"
                      />
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-400">%</span>
                    </div>
                  </div>
                  {/* Plazo entrega */}
                  <div className="px-3 py-3">
                    <Input
                      type="number"
                      min={1}
                      max={90}
                      value={row.lead_time_dias}
                      onChange={e => setFieldAny(nombre, 'lead_time_dias', e.target.value)}
                      className="h-8 text-sm w-full"
                      placeholder="3"
                      title="Días entre el pedido y la recepción"
                    />
                  </div>
                  {/* Día de pedido */}
                  <div className="px-3 py-3">
                    <div className="flex rounded-md overflow-hidden border border-input text-[10px]">
                      {['L','M','X','J','V','S','D'].map((d, i) => {
                        const val = String(i + 1)
                        const active = row.dia_pedido === val
                        return (
                          <button
                            key={d}
                            type="button"
                            onClick={() => setFieldAny(nombre, 'dia_pedido', active ? '' : val)}
                            title={['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'][i]}
                            className={`flex-1 py-1.5 text-center transition-colors border-l first:border-l-0 border-input ${
                              active
                                ? 'bg-indigo-600 text-white font-bold'
                                : 'bg-white text-zinc-500 hover:bg-zinc-50'
                            }`}
                          >{d}</button>
                        )
                      })}
                    </div>
                  </div>
                  {/* ID Dux (id_proveedor para compras) */}
                  <div className="px-3 py-3">
                    <Input
                      type="number"
                      value={row.dux_proveedor_id}
                      onChange={e => setFieldAny(nombre, 'dux_proveedor_id', e.target.value)}
                      className="h-8 text-sm w-full font-mono"
                      placeholder="ej: 17224537"
                      title="ID del proveedor en Dux (id_proveedor). Se usa para registrar compras."
                    />
                  </div>
                  {/* Notas */}
                  <div className="px-3 py-3">
                    <Input
                      value={row.notas}
                      onChange={e => setField(nombre, 'notas', e.target.value)}
                      className="h-8 text-sm w-full"
                      placeholder="Ej: entrega lunes y jueves"
                    />
                  </div>
                  {/* Guardar */}
                  <div className="px-3 py-3">
                    {row.saved ? (
                      <span className="text-xs text-green-600 font-medium">✓ Guardado</span>
                    ) : (
                      <Button
                        size="sm"
                        variant={row.dirty ? 'default' : 'outline'}
                        onClick={() => saveRow(nombre)}
                        disabled={row.saving || !row.dirty}
                        className="w-full h-8 text-xs"
                      >
                        {row.saving ? 'Guardando...' : <><Save size={12} className="mr-1" />Guardar</>}
                      </Button>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

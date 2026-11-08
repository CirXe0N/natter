// Create and edit share one form, driven by the field table in stream-config.ts.
import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"

import { ApiError, api } from "@/api"
import { CopyCli } from "@/components/copy-cli"
import { ScreenHeader } from "@/components/screen-header"
import { BlockedButton } from "@/components/blocked-button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useBlockedReason } from "@/contexts"
import { cliFor, defaults, fields, toConfig, toValues, type Config, type Field, type Values } from "@/stream-config"
import { useStream } from "@/screens/stream"

export function NewStreamScreen() {
  return (
    <>
      <ScreenHeader title="New stream">
        <Link to="/streams" className="text-xs text-muted-foreground hover:text-foreground hover:underline">
          All streams
        </Link>
      </ScreenHeader>
      <div className="px-8 pb-8">
        <StreamForm base={defaults} />
      </div>
    </>
  )
}

export function EditStream() {
  const { data: s, error } = useStream()
  if (error) return <p className="text-destructive">{error.message}</p>
  if (!s) return <p className="text-muted-foreground">Loading stream…</p>
  return <StreamForm base={s.config} editing />
}

function StreamForm({ base, editing }: { base: Config; editing?: boolean }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const blocked = useBlockedReason()
  const [values, setValues] = useState<Values>(() => toValues(base))
  const [local, setLocal] = useState<{ [key: string]: string }>({})
  const { config } = toConfig(base, values)
  const name = String(base.name ?? "")

  const save = useMutation({
    mutationFn: (cfg: Config) => (editing ? api.updateStream(name, cfg) : api.createStream(cfg)),
    onSuccess: async (sum) => {
      await qc.invalidateQueries({ queryKey: ["streams"] })
      await navigate({ to: "/streams/$stream", params: { stream: sum.name } })
    },
  })
  const field = save.error instanceof ApiError ? save.error.field : undefined
  const problems: { [key: string]: string } = { ...local, ...(field && save.error ? { [field]: save.error.message } : {}) }
  const general = save.error && !field ? save.error.message : undefined

  return (
    <form
      className="max-w-2xl space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        const r = toConfig(base, values)
        setLocal(r.errors)
        if (Object.keys(r.errors).length === 0) save.mutate(r.config)
      }}
    >
      {fields.map((f) => (
        <FieldRow key={f.key} f={f} value={values[f.key]} disabled={editing && f.fixed} error={problems[f.key]} onChange={(v) => setValues({ ...values, [f.key]: v })} />
      ))}
      {general && (
        <p role="alert" className="text-xs text-destructive">
          {general}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3 pt-2">
        <BlockedButton type="submit" reason={blocked} disabled={save.isPending}>
          {editing ? "Save changes" : "Create stream"}
        </BlockedButton>
        <CopyCli cmd={cliFor(config, editing ? base : undefined)} />
      </div>
    </form>
  )
}

export function FieldRow({ f, value, disabled, error, onChange }: { f: Field; value: string | boolean; disabled?: boolean; error?: string; onChange: (v: string | boolean) => void }) {
  const id = `field-${f.key}`
  const note = `${id}-note`
  const common = { id, disabled, "aria-invalid": error ? true : undefined, "aria-describedby": error || f.help ? note : undefined }
  const select = "h-8 rounded-lg border border-input bg-transparent px-2 text-sm disabled:opacity-50"
  return (
    <div className="grid grid-cols-[14rem_1fr] items-start gap-4">
      <label htmlFor={id} className="pt-1.5 text-xs text-muted-foreground">
        {f.label}
      </label>
      <div className="space-y-1">
        {f.kind === "list" ? (
          <Textarea {...common} value={String(value)} onChange={(e) => onChange(e.target.value)} className="font-mono" rows={3} />
        ) : f.kind === "select" ? (
          <select {...common} value={String(value)} onChange={(e) => onChange(e.target.value)} className={select}>
            {f.options!.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        ) : f.kind === "bool" ? (
          <input {...common} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} className="mt-2 size-4" />
        ) : (
          <Input {...common} value={String(value)} onChange={(e) => onChange(e.target.value)} className={f.kind === "text" ? "" : "font-mono"} />
        )}
        {(error || f.help) && (
          <p id={note} role={error ? "alert" : undefined} className={`text-xs ${error ? "text-destructive" : "text-muted-foreground"}`}>
            {error ?? (f.fixed && disabled ? "Fixed once created." : f.help)}
          </p>
        )}
      </div>
    </div>
  )
}

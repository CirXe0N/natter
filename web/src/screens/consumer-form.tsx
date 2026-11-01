// New and edit consumer: one form, driven by the field table in consumer-config.ts.
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate, useParams } from "@tanstack/react-router"
import { ArrowLeft } from "lucide-react"
import { cn } from "cn"

import { ApiError, api } from "@/api"
import { BlockedButton } from "@/components/blocked-button"
import { CopyCli } from "@/components/copy-cli"
import { ScreenHeader } from "@/components/screen-header"
import { Field, Section, Segmented, Switch } from "@/components/form"
import { buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useBlockedReason } from "@/contexts"
import { cliFor, defaults, fields, toConfig, toValues, visible, type Config, type Field as ConfigField, type Section as SectionKey, type Values } from "@/consumer-config"

const sections: { key: SectionKey; title: string; description: string }[] = [
  { key: "consumer", title: "Consumer", description: "What it is called, and whether it outlives the clients that use it." },
  { key: "delivery", title: "Delivery", description: "Which messages it hands out, starting where, and how fast." },
  { key: "ack", title: "Acknowledgement", description: "How clients confirm a message, and when the server sends it again." },
  { key: "pull", title: "Pull options", description: "Limits on the pull requests clients send, and priority groups." },
  { key: "push", title: "Push options", description: "Where the server pushes messages, and how it keeps subscribers in step." },
  { key: "storage", title: "Storage", description: "Where its state lives, and when an idle consumer is removed." },
]

export function NewConsumer() {
  return <ConsumerForm base={defaults} />
}

export function EditConsumer() {
  const { stream, consumer } = useParams({ from: "/consumers/$stream/$consumer/edit" })
  const { data: d, error } = useQuery({ queryKey: ["streams", "consumer", stream, consumer], queryFn: ({ signal }) => api.consumer(stream, consumer, signal) })
  if (error || !d)
    return (
      <>
        <ScreenHeader title="Edit consumer" />
        <p className={`px-8 ${error ? "text-destructive" : "text-muted-foreground"}`}>{error ? error.message : "Loading consumer…"}</p>
      </>
    )
  return <ConsumerForm editStream={stream} base={d.config} />
}

// A new consumer picks its stream in the form; an edited one keeps its own.
function ConsumerForm({ editStream, base }: { editStream?: string; base: Config }) {
  const editing = editStream !== undefined
  const navigate = useNavigate()
  const qc = useQueryClient()
  const blocked = useBlockedReason()
  const [picked, setPicked] = useState("")
  const stream = editStream ?? picked
  const streams = useQuery({ queryKey: ["streams", "list", ""], queryFn: ({ signal }) => api.streams("", signal), enabled: !editing })
  const [values, setValues] = useState<Values>(() => toValues(base))
  const [local, setLocal] = useState<{ [key: string]: string }>({})
  const [view, setView] = useState<"form" | "json">("form")
  const { config } = toConfig(base, values)
  const name = String(base.name ?? "")

  const save = useMutation({
    mutationFn: (cfg: Config) => (editing ? api.updateConsumer(stream, name, cfg) : api.createConsumer(stream, cfg)),
    onSuccess: async (sum) => {
      await qc.invalidateQueries({ queryKey: ["streams"] })
      await navigate({ to: "/consumers/$stream/$consumer", params: { stream, consumer: sum.name } })
    },
  })
  const field = save.error instanceof ApiError ? save.error.field : undefined
  const problems: { [key: string]: string } = { ...local, ...(field && save.error ? { [field]: save.error.message } : {}) }
  const general = save.error && !field ? save.error.message : undefined
  const set = (key: string, v: string | boolean) => setValues({ ...values, [key]: v })
  const back = editing ? (
    <Link to="/consumers/$stream/$consumer" params={{ stream, consumer: name }} className={buttonVariants({ variant: "outline" })}>
      Cancel
    </Link>
  ) : (
    <Link to="/consumers" className={buttonVariants({ variant: "outline" })}>
      Cancel
    </Link>
  )

  return (
    <>
      <ScreenHeader
        title={
          editing ? (
            <>
              Edit <span className="font-mono">{name}</span>
            </>
          ) : (
            "New consumer"
          )
        }
      >
        {editing ? (
          <Link to="/consumers/$stream/$consumer" params={{ stream, consumer: name }} className={buttonVariants({ variant: "ghost", size: "sm" })}>
            <ArrowLeft aria-hidden />
            <span className="font-mono">{name}</span>
          </Link>
        ) : (
          <Link to="/consumers" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            <ArrowLeft aria-hidden />
            All consumers
          </Link>
        )}
      </ScreenHeader>
      <form
        className="px-8 pb-10"
        aria-label={editing ? `Edit consumer ${name}` : "New consumer"}
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          const r = toConfig(base, values)
          const errors = stream ? r.errors : { ...r.errors, stream: "Choose the stream this consumer reads." }
          setLocal(errors)
          if (Object.keys(errors).length === 0) save.mutate(r.config)
          else setView("form")
        }}
      >
        <div className="mb-3 flex flex-wrap items-center gap-3">
          {editing && (
            <span className="text-xs text-muted-foreground">
              On stream{" "}
              <Link to="/streams/$stream" params={{ stream }} className="font-mono text-foreground hover:underline">
                {stream}
              </Link>
            </span>
          )}
          <div role="group" aria-label="View" className="ml-auto flex gap-1">
            {(["form", "json"] as const).map((t) => (
              <button key={t} type="button" aria-pressed={view === t} onClick={() => setView(t)} className={cn("rounded-md px-2.5 py-1 text-xs", view === t ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}>
                {t === "form" ? "Form" : "JSON"}
              </button>
            ))}
          </div>
        </div>

        {view === "form" ? (
          <div className="divide-y rounded-xl border bg-card">
            {sections.map((s) => {
              const shown = fields.filter((f) => f.section === s.key && visible(f, values))
              if (shown.length === 0) return null
              return (
                <Section key={s.key} title={s.title} description={s.description}>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {s.key === "consumer" && !editing && (
                      <Field label="Stream" hint="The stream whose messages it delivers. Fixed after create." error={problems.stream} className="sm:col-span-2 sm:w-1/2 sm:pr-2">
                        {(id, describedBy) => (
                          <select
                            id={id}
                            aria-describedby={describedBy}
                            aria-invalid={problems.stream ? true : undefined}
                            value={picked}
                            onChange={(e) => setPicked(e.target.value)}
                            className="h-8 w-full rounded-lg border border-input bg-transparent px-2 font-mono text-xs dark:bg-input/30"
                          >
                            <option value="">{streams.isPending ? "Loading streams…" : "Choose a stream"}</option>
                            {streams.data?.streams.map((st) => (
                              <option key={st.name} value={st.name}>
                                {st.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </Field>
                    )}
                    {shown.map((f) => (
                      <Control key={f.key} f={f} value={values[f.key]} onChange={(v) => set(f.key, v)} locked={editing && f.fixed} error={problems[f.key]} />
                    ))}
                  </div>
                </Section>
              )
            })}
          </div>
        ) : (
          <section aria-label="Config JSON" className="rounded-xl border bg-card p-4">
            <p className="mb-3 text-xs text-muted-foreground">The config Natter sends to the server, as the form has it now.</p>
            <pre className="overflow-auto rounded-lg border bg-background/60 p-3 font-mono text-[12px] leading-relaxed text-muted-foreground">{JSON.stringify(config, null, 2)}</pre>
          </section>
        )}

        {general && (
          <p role="alert" className="mt-3 text-xs text-destructive">
            {general}
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <div className="mr-auto min-w-0">
            <CopyCli cmd={cliFor(stream || "STREAM", config, editing ? base : undefined)} />
          </div>
          {back}
          <BlockedButton type="submit" reason={blocked} disabled={save.isPending}>
            {save.isPending ? "Saving…" : editing ? "Save changes" : "Create consumer"}
          </BlockedButton>
        </div>
      </form>
    </>
  )
}

// Control renders one field by its kind. A field fixed at create is shown, not editable.
function Control({ f, value, onChange, locked, error }: { f: ConfigField; value: string | boolean; onChange: (v: string | boolean) => void; locked?: boolean; error?: string }) {
  if (f.kind === "bool")
    return (
      <div className="sm:col-span-2">
        <Switch checked={value === true} onChange={onChange} label={f.label} description={error ? <span className="text-destructive">{error}</span> : f.help} disabled={locked} fixed={locked} />
      </div>
    )
  if (f.kind === "select" && f.options!.length <= 4) return <Segmented label={f.label} value={String(value)} options={f.options!} onChange={onChange} disabled={locked} fixed={locked} error={error} />
  const wide = f.kind === "list" || f.kind === "map" || f.key === "description"
  const mono = f.kind !== "text" || f.key === "name" || f.key === "deliver_subject" || f.key === "deliver_group"
  return (
    <Field label={f.label} hint={f.help} error={error} fixed={locked} className={wide ? "sm:col-span-2" : undefined}>
      {(id, describedBy) => {
        const common = { id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined, disabled: locked && f.key !== "name", readOnly: locked && f.key === "name" }
        if (f.kind === "select")
          return (
            <select {...common} value={String(value)} onChange={(e) => onChange(e.target.value)} className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-xs disabled:opacity-50 dark:bg-input/30">
              {f.options!.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )
        if (f.kind === "list" || f.kind === "map")
          return <Textarea {...common} rows={f.kind === "map" ? 2 : 3} spellCheck={false} placeholder={f.placeholder} value={String(value)} onChange={(e) => onChange(e.target.value)} className="font-mono text-xs md:text-xs" />
        return (
          <Input
            {...common}
            type={f.kind === "datetime" ? "datetime-local" : "text"}
            step={f.kind === "datetime" ? 1 : undefined}
            inputMode={f.kind === "number" ? "numeric" : undefined}
            spellCheck={false}
            autoComplete="off"
            placeholder={f.placeholder}
            value={String(value)}
            onChange={(e) => onChange(e.target.value)}
            className={cn("h-8 text-xs md:text-xs read-only:text-muted-foreground", mono && "font-mono")}
          />
        )
      }}
    </Field>
  )
}

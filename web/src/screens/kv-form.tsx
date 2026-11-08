// Create and edit a bucket with one form: the stream form's rows, driven by
// the field table in kv-config.ts.
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate, useParams } from "@tanstack/react-router"

import { ApiError, api } from "@/api"
import { BlockedButton } from "@/components/blocked-button"
import { buttonVariants } from "@/components/ui/button"
import { ScreenHeader } from "@/components/screen-header"
import { useBlockedReason } from "@/contexts"
import { bucketDefaults, bucketFields, toBucket } from "@/kv-config"
import { FieldRow } from "@/screens/stream-form"
import { toValues, type Config, type Values } from "@/stream-config"

export function NewBucketScreen() {
  return (
    <>
      <ScreenHeader title="New bucket">
        <Link to="/kv" className="text-xs text-muted-foreground hover:text-foreground hover:underline">
          All buckets
        </Link>
      </ScreenHeader>
      <div className="px-8 pb-8">
        <BucketForm base={bucketDefaults} />
      </div>
    </>
  )
}

export function EditBucketScreen() {
  const { bucket } = useParams({ from: "/kv/$bucket/edit" })
  const q = useQuery({ queryKey: ["kv", "config", bucket], queryFn: ({ signal }) => api.bucketConfig(bucket, signal) })
  return (
    <>
      <ScreenHeader title="Edit bucket">
        <Link to="/kv/$bucket" params={{ bucket }} className="font-mono text-xs text-muted-foreground hover:text-foreground hover:underline">
          {bucket}
        </Link>
      </ScreenHeader>
      <div className="px-8 pb-8">
        {q.isError ? (
          <p className="text-destructive">{q.error.message}</p>
        ) : !q.data ? (
          <p className="text-muted-foreground">Loading bucket…</p>
        ) : (
          // The server leaves file storage out of the config, so the defaults fill it in.
          <BucketForm base={{ ...bucketDefaults, ...q.data }} editing />
        )}
      </div>
    </>
  )
}

function BucketForm({ base, editing }: { base: Config; editing?: boolean }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const blocked = useBlockedReason()
  const [values, setValues] = useState<Values>(() => toValues(base, bucketFields))
  const [local, setLocal] = useState<{ [key: string]: string }>({})
  const name = String(base.bucket ?? "")
  const save = useMutation({
    mutationFn: (cfg: Config) => (editing ? api.updateBucket(name, cfg) : api.createBucket(cfg)),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["kv"] })
      await (editing ? navigate({ to: "/kv/$bucket", params: { bucket: name } }) : navigate({ to: "/kv" }))
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
        const r = toBucket(values, editing ? base : undefined)
        setLocal(r.errors)
        if (Object.keys(r.errors).length === 0) save.mutate(r.config)
      }}
    >
      {bucketFields.map((f) => (
        <FieldRow key={f.key} f={f} value={values[f.key]} disabled={editing && f.fixed} error={problems[f.key]} onChange={(v) => setValues({ ...values, [f.key]: v })} />
      ))}
      {general && (
        <p role="alert" className="text-xs text-destructive">
          {general}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3 pt-2">
        {editing ? (
          <Link to="/kv/$bucket" params={{ bucket: name }} className={buttonVariants({ variant: "outline" })}>
            Cancel
          </Link>
        ) : (
          <Link to="/kv" className={buttonVariants({ variant: "outline" })}>
            Cancel
          </Link>
        )}
        <BlockedButton type="submit" reason={blocked} disabled={save.isPending}>
          {editing ? "Save changes" : "Create bucket"}
        </BlockedButton>
      </div>
    </form>
  )
}

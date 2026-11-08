// The New bucket form: the stream form's rows, driven by the field table in kv-config.ts.
import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"

import { ApiError, api } from "@/api"
import { BlockedButton } from "@/components/blocked-button"
import { ScreenHeader } from "@/components/screen-header"
import { useBlockedReason } from "@/contexts"
import { bucketDefaults, bucketFields, toBucket } from "@/kv-config"
import { FieldRow } from "@/screens/stream-form"
import { toValues, type Config, type Values } from "@/stream-config"

export function NewBucketScreen() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const blocked = useBlockedReason()
  const [values, setValues] = useState<Values>(() => toValues(bucketDefaults, bucketFields))
  const [local, setLocal] = useState<{ [key: string]: string }>({})
  const save = useMutation({
    mutationFn: (cfg: Config) => api.createBucket(cfg),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["kv", "buckets"] })
      await navigate({ to: "/kv" })
    },
  })
  const field = save.error instanceof ApiError ? save.error.field : undefined
  const problems: { [key: string]: string } = { ...local, ...(field && save.error ? { [field]: save.error.message } : {}) }
  const general = save.error && !field ? save.error.message : undefined

  return (
    <>
      <ScreenHeader title="New bucket">
        <Link to="/kv" className="text-xs text-muted-foreground hover:text-foreground hover:underline">
          All buckets
        </Link>
      </ScreenHeader>
      <div className="px-8 pb-8">
        <form
          className="max-w-2xl space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            const r = toBucket(values)
            setLocal(r.errors)
            if (Object.keys(r.errors).length === 0) save.mutate(r.config)
          }}
        >
          {bucketFields.map((f) => (
            <FieldRow key={f.key} f={f} value={values[f.key]} error={problems[f.key]} onChange={(v) => setValues({ ...values, [f.key]: v })} />
          ))}
          {general && (
            <p role="alert" className="text-xs text-destructive">
              {general}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <BlockedButton type="submit" reason={blocked} disabled={save.isPending}>
              Create bucket
            </BlockedButton>
          </div>
        </form>
      </div>
    </>
  )
}

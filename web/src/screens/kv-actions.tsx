// KV mutations: New bucket in the Key-Value header, Put key in the bucket header, Delete and Purge on an open key.
// Purge drops the key's history, so it asks first; delete leaves a marker and does not.
import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { api } from "@/api";
import { BlockedButton } from "@/components/blocked-button";
import { CopyCli } from "@/components/copy-cli";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useBlockedReason } from "@/contexts";
import { shellQuote } from "@/stream-config";

export function NewBucketButton() {
  const navigate = useNavigate();
  const blocked = useBlockedReason();
  return (
    <BlockedButton reason={blocked} onClick={() => void navigate({ to: "/kv/new" })}>
      New bucket
    </BlockedButton>
  );
}

export function PutKey({ bucket, name }: { bucket: string; name?: string }) {
  const blocked = useBlockedReason();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(name ?? "");
  const [value, setValue] = useState("");
  const put = useMutation({
    mutationFn: () => api.kvPut(bucket, key, value),
    onSuccess: () => setOpen(false),
  });
  return (
    <>
      <BlockedButton
        reason={blocked}
        variant="outline"
        onClick={() => setOpen(true)}
      >
        {name ? "Put value" : "Put key"}
      </BlockedButton>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Put a value in {bucket}</DialogTitle>
            <DialogDescription>
              Stores a new revision. A key that does not exist is created.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (key) put.mutate();
            }}
          >
            <label className="grid gap-1.5 text-xs">
              Key
              <Input
                value={key}
                onChange={(e) => setKey(e.target.value)}
                readOnly={!!name}
                className="font-mono"
                autoComplete="off"
              />
            </label>
            <label className="grid gap-1.5 text-xs">
              Value
              <textarea
                value={value}
                onChange={(e) => setValue(e.target.value)}
                rows={5}
                className="rounded-md border bg-background p-2 font-mono text-xs"
              />
            </label>
            <CopyCli
              cmd={`nats kv put ${shellQuote(bucket)} ${shellQuote(key || "<key>")} ${shellQuote(value)}`}
            />
            {put.error && (
              <p role="alert" className="text-xs text-destructive">
                {put.error.message}
              </p>
            )}
            <DialogFooter>
              <Button type="submit" disabled={!key || put.isPending}>
                Put
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function KeyActions({ bucket, name }: { bucket: string; name: string }) {
  const blocked = useBlockedReason();
  const reason = useId();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const del = useMutation({
    mutationFn: () => api.kvDelete(bucket, name, false),
  });
  const purge = useMutation({
    mutationFn: () => api.kvDelete(bucket, name, true),
    onSuccess: async () => {
      setConfirm(false);
      await qc.invalidateQueries({ queryKey: ["kv", "history", bucket, name] });
    },
  });
  const block = {
    disabled: !!blocked,
    focusableWhenDisabled: true,
    "aria-describedby": blocked ? reason : undefined,
  } as const;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        {...block}
        disabled={block.disabled || del.isPending}
        onClick={() => del.mutate()}
      >
        Delete
      </Button>
      <Button
        variant="destructive"
        size="sm"
        {...block}
        onClick={() => setConfirm(true)}
      >
        Purge…
      </Button>
      {blocked && (
        <span id={reason} className="text-xs text-muted-foreground">
          {blocked}
        </span>
      )}
      <CopyCli
        cmd={`nats kv del ${shellQuote(bucket)} ${shellQuote(name)} --force`}
      />
      {del.error && (
        <p role="alert" className="w-full text-xs text-destructive">
          {del.error.message}
        </p>
      )}
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Purge {name}</DialogTitle>
            <DialogDescription>
              Removes the key and every earlier revision of it. This cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <CopyCli
            cmd={`nats kv purge ${shellQuote(bucket)} ${shellQuote(name)} --force`}
          />
          {purge.error && (
            <p role="alert" className="text-xs text-destructive">
              {purge.error.message}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={purge.isPending}
              onClick={() => purge.mutate()}
            >
              Purge key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

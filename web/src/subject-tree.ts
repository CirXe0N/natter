// A stream's subjects as a tree split on ".". total counts the messages on a
// subject and every subject below it; own counts only the subject itself.
export type SubjectNode = { token: string; subject: string; total: number; own: number; children: SubjectNode[] }

export function subjectTree(subjects: Record<string, number>): SubjectNode[] {
  const root: SubjectNode = { token: "", subject: "", total: 0, own: 0, children: [] }
  const bySubject = new Map<string, SubjectNode>()
  for (const [subject, n] of Object.entries(subjects)) {
    let node = root
    for (const token of subject.split(".")) {
      const path = node.subject ? `${node.subject}.${token}` : token
      let child = bySubject.get(path)
      if (!child) {
        child = { token, subject: path, total: 0, own: 0, children: [] }
        bySubject.set(path, child)
        node.children.push(child)
      }
      child.total += n
      node = child
    }
    node.own += n
  }
  for (const n of [root, ...bySubject.values()]) n.children.sort((a, b) => (a.token < b.token ? -1 : a.token > b.token ? 1 : 0))
  return root.children
}

# Conformance fixtures

Manifests (the contents of `taste.json`) that every implementation should agree on. Each file is
`{"description": …, "manifest": {…}}`.

- `valid/`: must pass validation. Blob references are not checked against a container here.
- `invalid/`: must fail validation. `problems` lists the JSON Pointers of every reported problem
  (sorted, without duplicates), so implementations agree on where each error is. `schema_catches`
  says whether `taste.schema.json` alone rejects it; when `false`, only the rules in SPEC.md
  section 5 do.

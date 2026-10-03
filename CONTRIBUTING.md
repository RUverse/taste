# Contributing to taste

Thanks for helping out. This guide covers how branches, pull requests, and releases work. For the
layout and the rules every change follows, read [AGENTS.md](AGENTS.md). The format itself is
described in [spec/SPEC.md](spec/SPEC.md), and the [README](README.md) shows how to run things.

## Branches

| Branch | Purpose | Who writes to it |
| --- | --- | --- |
| `main` | Released code. Its latest commit is always the latest release. | The release process only |
| `dev` | Integration branch for the next release. | Pull requests only |
| `feature/…`, `fix/…`, `docs/…`, `spec/…`, `chore/…` | One change each, branched from `dev`. | You |

The rules:

- Always branch from `dev`, never from `main`.
- Always open pull requests against `dev`. A pull request against `main` will be asked to
  retarget `dev`.
- Never push directly to `dev` or `main`.
- Keep a branch to one topic. Unrelated fixes go in their own branch and pull request.

## Making a change

```bash
git fetch origin
git switch -c feature/short-description origin/dev

# ...edit, then run the checks below...

git push -u origin feature/short-description
gh pr create --base dev
```

If `dev` moves while your branch is open, rebase onto it rather than merging it in:

```bash
git fetch origin
git rebase origin/dev
git push --force-with-lease
```

## Changing the format

`spec/SPEC.md` is the source of truth, and every implementation has to agree with it. A pull
request that changes the format updates, together:

- `spec/SPEC.md`, and the format version when the change is not backward compatible;
- `spec/taste.schema.json`;
- the Python validator (`python/src/taste/validate.py`) and the TypeScript one
  (`js/src/validate.ts`);
- fixtures in `spec/fixtures/` that show the new rule, with the exact problem paths;
- the sample file, by rerunning `python/scripts/build_example.py`, when it should show the change.

Open an issue first for larger format changes, so the design can be discussed before the work.
Fields that only one tool needs can use an `x-` prefix without a format change.

## Before opening a pull request

Run the same checks the maintainers run. From the repository root:

```bash
bun install
bun run test
bun run check
bun run build
```

From `python/`:

```bash
uv sync --extra dev
uv run pytest -q
uv run ruff check .
uv run ruff format --check .
```

Also:

- Add or update tests for behavior changes. Files written by one implementation must open and
  validate in the other.
- Run `uv build` from `python/` when packaging changes.
- For viewer changes, check the real page at desktop and phone widths in both light and dark OS
  themes, and include screenshots in the pull request.
- Keep file access in the viewer inside `viewer/src/lib/platform.ts`, so the planned desktop
  builds can replace it.
- Update the README files when user-visible behavior changes.
- Never commit secrets or details of a particular machine (hostnames, IP addresses, personal
  paths), and only commit media you have the right to share. This repository is public.

## Pull requests

- Write a title that says what changes for the user, and a description that explains why and how
  it was tested.
- A pull request is merged into `dev` once the checks pass and it has been reviewed.
- Pull requests are squash-merged, so `dev` gets one commit per pull request. The pull request
  title becomes the commit subject.

## Releases

Releases move `dev` into `main`; nothing else changes `main`.

1. On a branch from `dev`, bump the versions in `python/pyproject.toml`,
   `python/src/taste/__init__.py`, `js/package.json`, and `viewer/package.json`, and open a pull
   request to `dev`.
2. After it is merged, fast-forward `main` to `dev` (`git merge --ff-only origin/dev` on `main`)
   so both branches share the same commits.
3. Tag the release as `vX.Y.Z` and publish a GitHub release from that tag.

Do not squash `dev` into `main`: squashing would make `main` and `dev` diverge.

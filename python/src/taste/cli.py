"""The ``taste`` command: inspect and edit .taste files from a shell or an agent."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any

from taste import __version__
from taste.container import TasteError
from taste.document import Taste, actor
from taste.media import extension
from taste.validate import AT_INTEGERS

Handler = Callable[[argparse.Namespace], int]
_COMMANDS: dict[str, Handler] = {}


def main(argv: Sequence[str] | None = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)
    try:
        return _COMMANDS[args.command](args)
    except TasteError as error:
        print(f"taste: error: {error}", file=sys.stderr)
        return 1
    except BrokenPipeError:
        return 0


def _command(name: str) -> Callable[[Handler], Handler]:
    def register(handler: Handler) -> Handler:
        _COMMANDS[name] = handler
        return handler

    return register


# Reading


@_command("info")
def _info(args: argparse.Namespace) -> int:
    with Taste.open(args.file, any_version=True) as doc:
        files = [f for item in doc.items.values() for f in item.get("files", [])]
        kinds: dict[str, int] = {}
        for item in doc.items.values():
            kinds[item.get("kind", "?")] = kinds.get(item.get("kind", "?"), 0) + 1
        summary = {
            "file": str(args.file),
            "version": doc.manifest.get("taste"),
            "title": doc.title,
            "collections": [
                {"id": c["id"], "name": c.get("name", ""), "items": len(c.get("entries", []))}
                for c in doc.collections
            ],
            "items": len(doc.items),
            "kinds": dict(sorted(kinds.items())),
            "files": len(files),
            "stored_files": sum(1 for f in files if "blob" in f),
            "unsorted": len(doc.unsorted()),
            "bytes": Path(args.file).stat().st_size,
        }
    if args.json:
        _print_json(summary)
        return 0
    print(summary["title"] or Path(args.file).name)
    print(f"format {summary['version']}, {_size(summary['bytes'])}")
    print(
        f"{len(summary['collections'])} collections, {summary['items']} items, "
        f"{summary['files']} files ({summary['stored_files']} stored)"
    )
    if summary["kinds"]:
        print("kinds: " + ", ".join(f"{k} {n}" for k, n in summary["kinds"].items()))
    for collection in summary["collections"]:
        print(f"  {collection['name']}  [{collection['id']}]  {collection['items']} items")
    if summary["unsorted"]:
        print(f"  (unsorted)  {summary['unsorted']} items")
    return 0


@_command("tree")
def _tree(args: argparse.Namespace) -> int:
    with Taste.open(args.file, any_version=True) as doc:
        print(doc.title or Path(args.file).name)
        groups: list[tuple[str, list[tuple[str, list[str], str]]]] = []
        for collection in doc.collections:
            header = f"{collection.get('name', '')}  [{collection['id']}]"
            if collection.get("vibe"):
                header += f"\n  {_clip(collection['vibe'], 90)}"
            entries = [
                (e.get("item"), e.get("show", []), e.get("note", ""))
                for e in collection.get("entries", [])
            ]
            groups.append((header, entries))
        unsorted = doc.unsorted()
        if unsorted:
            groups.append(("(unsorted)", [(item_id, [], "") for item_id in unsorted]))
        for header, entries in groups:
            print()
            print(header)
            for index, (item_id, shown, note) in enumerate(entries):
                last = index == len(entries) - 1
                _print_item(doc, item_id, shown, note, last, files=not args.no_files)
    return 0


def _print_item(
    doc: Taste, item_id: str, shown: list[str], note: str, last: bool, *, files: bool
) -> None:
    branch, indent = ("└─ ", "   ") if last else ("├─ ", "│  ")
    item = doc.items.get(item_id, {})
    title = item.get("title", "?")
    parent = doc.items.get(item.get("parent", ""))
    if parent is not None:
        title = f"{parent.get('title', '?')} · {title}"
    if "year" in item:
        title += f" ({item['year']})"
    print(f"  {branch}{item.get('kind', '?'):<15} {title}  [{item_id}]")
    lines = []
    if note:
        lines.append(f"note: {_clip(note, 80)}")
    if files:
        for entry in item.get("files", []):
            mark = "*" if entry.get("id") in shown else " "
            where = _at(entry.get("at", {}))
            text = entry.get("caption") or entry.get("name") or entry.get("url") or ""
            parts = [f"{entry.get('role', '?'):<11}", entry.get("type", "")]
            if where:
                parts.append(where)
            if text:
                parts.append(_clip(text, 60))
            lines.append(f"{mark}{'  '.join(parts)}  [{entry.get('id')}]")
    for index, line in enumerate(lines):
        sub = "└─ " if index == len(lines) - 1 else "├─ "
        print(f"  {indent}{sub}{line}")


@_command("show")
def _show(args: argparse.Namespace) -> int:
    with Taste.open(args.file, any_version=True) as doc:
        if args.id is None:
            value: Any = doc.manifest
        elif args.collection:
            value = doc.collection(args.id)
        else:
            value = {"id": args.id, **doc.item(args.id), "collections": doc.collections_of(args.id)}
    _print_json(value)
    return 0


@_command("find")
def _find(args: argparse.Namespace) -> int:
    tags = _pairs(args.conditions)
    with Taste.open(args.file, any_version=True) as doc:
        if args.files:
            matches = doc.find_files(role=args.role, tags=tags, text=args.text)
            rows = [{"item": item_id, **doc.file(item_id, file_id)} for item_id, file_id in matches]
            if args.json:
                _print_json(rows)
            for row in [] if args.json else rows:
                text = row.get("caption") or row.get("name") or ""
                print(f"{row['item']}/{row['id']}\t{row.get('role')}\t{_clip(text, 70)}")
            return 0
        ids = doc.find(kind=args.kind, collection=args.collection, tags=tags, text=args.text)
        if args.json:
            _print_json([{"id": item_id, **doc.items[item_id]} for item_id in ids])
            return 0
        for item_id in ids:
            item = doc.items[item_id]
            print(f"{item_id}\t{item.get('kind')}\t{item.get('title')}")
    return 0


@_command("extract")
def _extract(args: argparse.Namespace) -> int:
    with Taste.open(args.file, any_version=True) as doc:
        entry = doc.file(args.item, args.file_id)
        ref = entry.get("thumb") if args.thumb else entry.get("blob")
        if ref is None:
            what = "thumbnail" if args.thumb else "stored content"
            raise TasteError(f"file {args.file_id!r} has no {what}; its url is {entry.get('url')}")
        if args.output == "-":
            with doc.open_blob(ref) as source:
                shutil.copyfileobj(source, sys.stdout.buffer)
            return 0
        if args.output:
            target = Path(args.output)
        elif args.thumb:
            target = Path(f"{args.item}-{args.file_id}-thumb.webp")
        else:
            target = Path(entry.get("name") or f"{args.item}-{args.file_id}")
            if not target.suffix:
                target = target.with_suffix(extension(entry.get("type", "")))
        with doc.open_blob(ref) as source, target.open("wb") as output:
            shutil.copyfileobj(source, output)
    print(target)
    return 0


@_command("validate")
def _validate(args: argparse.Namespace) -> int:
    with Taste.open(args.file, any_version=True) as doc:
        problems = doc.validate(deep=args.deep)
    for problem in problems:
        print(problem)
    if problems:
        print(f"{len(problems)} problem(s) in {args.file}", file=sys.stderr)
        return 1
    print(f"{args.file}: valid")
    return 0


# Writing


@_command("new")
def _new(args: argparse.Namespace) -> int:
    path = Path(args.file)
    if path.exists() and not args.force:
        raise TasteError(f"{path} already exists; use --force to replace it")
    Taste.new(args.title or "", args.description or "").save(path)
    print(path)
    return 0


@_command("add-collection")
def _add_collection(args: argparse.Namespace) -> int:
    with _editing(args.file) as doc:
        collection = doc.add_collection(
            args.name,
            id=args.id,
            vibe=args.vibe,
            description=args.description,
            icon=args.icon,
            tags=_pairs(args.tag),
        )
    print(collection["id"])
    return 0


@_command("remove-collection")
def _remove_collection(args: argparse.Namespace) -> int:
    with _editing(args.file) as doc:
        removed = doc.remove_collection(args.collection, prune=args.prune)
    for item_id in removed:
        print(f"removed item {item_id}")
    return 0


@_command("set-cover")
def _set_cover(args: argparse.Namespace) -> int:
    with _editing(args.file) as doc:
        doc.set_cover(args.collection, Path(args.path), type=args.type, caption=args.caption)
    return 0


@_command("add-item")
def _add_item(args: argparse.Namespace) -> int:
    fields: dict[str, Any] = _json_arg(args.json) if args.json else {}
    if not isinstance(fields, dict):
        raise TasteError("--json must be an item object")
    kind, title = fields.pop("kind", None), fields.pop("title", None)
    kind, title = args.kind or kind, args.title or title
    if not kind or not title:
        raise TasteError("an item needs --kind and --title (or both in --json)")
    if args.year is not None:
        fields["year"] = args.year
    if args.summary:
        fields["summary"] = args.summary
    for key, pairs in (("ids", args.ext), ("meta", args.meta), ("tags", args.tag)):
        if pairs:
            fields[key] = {**fields.get(key, {}), **_pairs(pairs)}
    if args.link:
        fields["links"] = fields.get("links", []) + [{"url": url} for url in args.link]
    if args.available:
        offers = [_json_arg(value) for value in args.available]
        fields["availability"] = fields.get("availability", []) + offers
    if args.parent:
        fields["parent"] = args.parent
    with _editing(args.file) as doc:
        item_id = doc.add_item(kind, title, id=args.id, by=_by(args), **fields)
        for collection_id in args.to or []:
            doc.add_entry(collection_id, item_id, note=args.note, reason=args.reason, by=_by(args))
    print(item_id)
    return 0


@_command("set")
def _set(args: argparse.Namespace) -> int:
    values = _pairs(args.values, merge_lists=False)
    with _editing(args.file) as doc:
        target = doc.collection(args.id) if args.collection else doc.item(args.id)
        for key, value in values.items():
            _set_path(target, key, value)
        for key in args.unset or []:
            _set_path(target, key, None, remove=True)
    return 0


@_command("remove-item")
def _remove_item(args: argparse.Namespace) -> int:
    with _editing(args.file) as doc:
        doc.remove_item(args.item)
    return 0


@_command("link")
def _link(args: argparse.Namespace) -> int:
    with _editing(args.file) as doc:
        doc.add_entry(
            args.collection,
            args.item,
            note=args.note,
            show=args.show,
            reason=args.reason,
            by=_by(args),
            position=args.position,
        )
    return 0


@_command("unlink")
def _unlink(args: argparse.Namespace) -> int:
    with _editing(args.file) as doc:
        doc.remove_entry(args.collection, args.item)
    return 0


@_command("move")
def _move(args: argparse.Namespace) -> int:
    with _editing(args.file) as doc:
        doc.move_entry(args.collection, args.item, args.position)
    return 0


@_command("attach")
def _attach(args: argparse.Namespace) -> int:
    at = _pairs(args.at, merge_lists=False)
    for key in AT_INTEGERS:
        if isinstance(at.get(key), str) and at[key].isdigit():
            at[key] = int(at[key])
    with _editing(args.file) as doc:
        entry = doc.attach(
            args.item,
            Path(args.path) if args.path else None,
            role=args.role,
            url=args.url,
            type=args.type,
            name=args.name,
            id=args.id,
            caption=args.caption,
            at=at,
            tags=_pairs(args.tag),
            by=_by(args),
        )
        for collection_id in args.show_in or []:
            entries = doc.collection(collection_id).get("entries", [])
            placed = next((e for e in entries if e.get("item") == args.item), None)
            if placed is None:
                raise TasteError(f"item {args.item!r} is not in collection {collection_id!r}")
            placed.setdefault("show", []).append(entry["id"])
    print(entry["id"])
    return 0


@_command("detach")
def _detach(args: argparse.Namespace) -> int:
    with _editing(args.file) as doc:
        doc.detach(args.item, args.file_id)
    return 0


@_command("tag")
def _tag(args: argparse.Namespace) -> int:
    values = _pairs(args.values)
    with _editing(args.file) as doc:
        if args.collection:
            target = doc.collection(args.target)
        elif "/" in args.target:
            item_id, _, file_id = args.target.partition("/")
            target = doc.file(item_id, file_id)
        else:
            target = doc.item(args.target)
        tags = doc.tag(target, values, args.remove)
    _print_json(tags)
    return 0


@_command("pack")
def _pack(args: argparse.Namespace) -> int:
    target = Path(args.output)
    if target.exists() and not args.force:
        raise TasteError(f"{target} already exists; use --force to replace it")
    Taste.from_folder(args.file).save(target)
    print(target)
    return 0


@_command("unpack")
def _unpack(args: argparse.Namespace) -> int:
    with Taste.open(args.file, any_version=True) as doc:
        print(doc.unpack(args.folder))
    return 0


class _editing:
    """Open a file for a change and save it only if the change succeeds."""

    def __init__(self, path: str) -> None:
        self.doc = Taste.open(path)

    def __enter__(self) -> Taste:
        return self.doc

    def __exit__(self, kind: type[BaseException] | None, *_: object) -> None:
        try:
            if kind is None:
                self.doc.save()
        finally:
            self.doc.close()


# Argument helpers


def _pairs(values: Sequence[str] | None, *, merge_lists: bool = True) -> dict[str, Any]:
    """``key=text`` and ``key:=json`` arguments as a dict.

    With ``merge_lists``, repeating a text key collects the values into a list.
    """

    result: dict[str, Any] = {}
    for raw in values or []:
        key, json_sep, json_value = raw.partition(":=")
        if json_sep and "=" not in key:
            try:
                value: Any = json.loads(json_value)
            except json.JSONDecodeError as error:
                raise TasteError(f"{raw!r}: value after ':=' is not JSON ({error})") from error
        else:
            key, sep, value = raw.partition("=")
            if not sep:
                raise TasteError(f"{raw!r}: expected key=value or key:=json")
        if not key:
            raise TasteError(f"{raw!r}: missing key")
        if merge_lists and key in result and isinstance(value, str):
            existing = result[key]
            result[key] = (existing if isinstance(existing, list) else [existing]) + [value]
        else:
            result[key] = value
    return result


def _set_path(target: dict[str, Any], dotted: str, value: Any, *, remove: bool = False) -> None:
    keys = dotted.split(".")
    for key in keys[:-1]:
        child = target.setdefault(key, {})
        if not isinstance(child, dict):
            raise TasteError(f"{dotted!r}: {key!r} is not an object")
        target = child
    if remove:
        target.pop(keys[-1], None)
    else:
        target[keys[-1]] = value


def _json_arg(value: str) -> Any:
    text = Path(value[1:]).read_text(encoding="utf-8") if value.startswith("@") else value
    try:
        return json.loads(text)
    except json.JSONDecodeError as error:
        raise TasteError(f"not valid JSON: {error}") from error


def _by(args: argparse.Namespace) -> dict[str, str]:
    return actor(args.by or os.environ.get("TASTE_BY") or "user")


def _print_json(value: Any) -> None:
    print(json.dumps(value, indent=2, ensure_ascii=False))


def _clip(text: str, limit: int) -> str:
    text = " ".join(str(text).split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _at(at: dict[str, Any]) -> str:
    parts = []
    if "season" in at:
        parts.append(f"S{at['season']:02d}" + (f"E{at['episode']:02d}" if "episode" in at else ""))
    for key in ("platform", "chapter", "level", "location", "track", "page", "section"):
        if key in at:
            parts.append(f"{key} {at[key]}")
    for key in ("time", "playtime"):
        if key in at:
            parts.append(at[key] if key == "time" else f"played {at[key]}")
    return " ".join(parts)


def _size(count: int) -> str:
    size = float(count)
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024 or unit == "GB":
            return f"{size:.0f} {unit}" if unit == "B" else f"{size:.1f} {unit}"
        size /= 1024
    return f"{count} B"


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="taste",
        description="Inspect and edit .taste files.",
        epilog=(
            "Values: key=text sets a string (repeat a key for a list); key:=json sets any JSON "
            "value, such as rating:=5 or watched:=true. Set TASTE_BY=agent:<name> or pass "
            "--by so additions are credited to an agent."
        ),
    )
    parser.add_argument("--version", action="version", version=f"taste {__version__}")
    commands = parser.add_subparsers(dest="command", required=True, metavar="command")

    def command(name: str, help: str) -> argparse.ArgumentParser:
        sub = commands.add_parser(name, help=help, description=help)
        sub.add_argument("file", help=".taste file" if name != "pack" else "unpacked folder")
        return sub

    def by(sub: argparse.ArgumentParser) -> None:
        sub.add_argument("--by", help="who is adding: user (default) or agent:<name>")

    sub = command("info", "Summarise a file")
    sub.add_argument("--json", action="store_true")

    sub = command("tree", "Print collections, items, and files as a tree")
    sub.add_argument("--no-files", action="store_true", help="hide files under items")

    sub = command("show", "Print the manifest, or one item or collection, as JSON")
    sub.add_argument("id", nargs="?")
    sub.add_argument("-c", "--collection", action="store_true", help="id is a collection")

    sub = command("find", "Find items (or files) by kind, collection, tags, or text")
    sub.add_argument("conditions", nargs="*", metavar="TAG=VALUE")
    sub.add_argument("--kind")
    sub.add_argument("--in", dest="collection", metavar="COLLECTION")
    sub.add_argument("--text")
    sub.add_argument("--files", action="store_true", help="find files instead of items")
    sub.add_argument("--role", help="with --files: only this role")
    sub.add_argument("--json", action="store_true")

    sub = command("extract", "Write a stored file out")
    sub.add_argument("item")
    sub.add_argument("file_id")
    sub.add_argument("-o", "--output", help="path, or - for standard output")
    sub.add_argument("--thumb", action="store_true", help="extract the thumbnail instead")

    sub = command("validate", "Check a file against the spec")
    sub.add_argument("--deep", action="store_true", help="also re-hash every stored file")

    sub = command("new", "Create an empty file")
    sub.add_argument("--title")
    sub.add_argument("--description")
    sub.add_argument("--force", action="store_true")

    sub = command("add-collection", "Add a collection; prints its id")
    sub.add_argument("name")
    sub.add_argument("--id")
    sub.add_argument("--vibe", help="what ties the collection together")
    sub.add_argument("--description")
    sub.add_argument("--icon")
    sub.add_argument("--tag", action="append", metavar="KEY=VALUE")

    sub = command("remove-collection", "Remove a collection (its items stay)")
    sub.add_argument("collection")
    sub.add_argument("--prune", action="store_true", help="also remove items left unsorted")

    sub = command("set-cover", "Set a collection's cover image")
    sub.add_argument("collection")
    sub.add_argument("path")
    sub.add_argument("--type")
    sub.add_argument("--caption")

    sub = command("add-item", "Add an item; prints its id")
    sub.add_argument("--kind", help="movie, tv, music.track, article, game…")
    sub.add_argument("--title")
    sub.add_argument("--id")
    sub.add_argument("--year", type=int)
    sub.add_argument("--summary")
    sub.add_argument("--ext", action="append", metavar="CATALOG=ID", help="e.g. tmdb:=153")
    sub.add_argument("--meta", action="append", metavar="KEY=VALUE")
    sub.add_argument("--tag", action="append", metavar="KEY=VALUE")
    sub.add_argument("--link", action="append", metavar="URL")
    sub.add_argument("--available", action="append", metavar="JSON", help='{"service": …}')
    sub.add_argument("--parent", metavar="ITEM")
    sub.add_argument("--json", help="item fields as JSON, or @file.json")
    sub.add_argument("--to", action="append", metavar="COLLECTION", help="also add to these")
    sub.add_argument("--note", help="with --to: note in the collection")
    sub.add_argument("--reason", help="with --to: why it belongs")
    by(sub)

    sub = command("set", "Set fields on an item or collection (dotted keys: meta.runtime:=102)")
    sub.add_argument("id")
    sub.add_argument("values", nargs="*", metavar="KEY=VALUE")
    sub.add_argument("--unset", action="append", metavar="KEY")
    sub.add_argument("-c", "--collection", action="store_true", help="id is a collection")

    sub = command("remove-item", "Remove an item from the file and all collections")
    sub.add_argument("item")

    sub = command("link", "Put an item in a collection")
    sub.add_argument("collection")
    sub.add_argument("item")
    sub.add_argument("--note")
    sub.add_argument("--reason")
    sub.add_argument("--show", action="append", metavar="FILE_ID")
    sub.add_argument("--position", type=int)
    by(sub)

    sub = command("unlink", "Take an item out of a collection (the item stays)")
    sub.add_argument("collection")
    sub.add_argument("item")

    sub = command("move", "Move an item to a position in a collection")
    sub.add_argument("collection")
    sub.add_argument("item")
    sub.add_argument("position", type=int)

    sub = command("attach", "Add a file (stored, or by --url) to an item; prints its id")
    sub.add_argument("item")
    sub.add_argument("path", nargs="?")
    sub.add_argument("--url")
    sub.add_argument("--role", required=True, help="poster, screenshot, media, snapshot…")
    sub.add_argument("--type", help="media type; detected when omitted")
    sub.add_argument("--name")
    sub.add_argument("--id")
    sub.add_argument("--caption", help="what the file shows, in words")
    sub.add_argument("--at", action="append", metavar="KEY=VALUE", help="time=00:23:41, season=1")
    sub.add_argument("--tag", action="append", metavar="KEY=VALUE")
    sub.add_argument("--show-in", action="append", metavar="COLLECTION")
    by(sub)

    sub = command("detach", "Remove a file from an item")
    sub.add_argument("item")
    sub.add_argument("file_id")

    sub = command("tag", "Set or remove tags on an item, ITEM/FILE, or collection (-c)")
    sub.add_argument("target")
    sub.add_argument("values", nargs="*", metavar="KEY=VALUE")
    sub.add_argument("--remove", action="append", metavar="KEY")
    sub.add_argument("-c", "--collection", action="store_true")

    sub = command("pack", "Build a .taste file from an unpacked folder")
    sub.add_argument("output")
    sub.add_argument("--force", action="store_true")

    sub = command("unpack", "Write taste.json and stored files into a folder")
    sub.add_argument("folder")

    return parser


def run() -> None:
    sys.exit(main())

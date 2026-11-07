"""Regenerate THIRD-PARTY-NOTICES.txt from the dependency graph.

    python scripts/notices/generate-notices.py           writes the file
    python scripts/notices/generate-notices.py --check   fails if it is out of date

Rust crates come from Cargo.lock through `cargo metadata --locked`; JavaScript,
CSS and fonts are the modules Vite writes into the production bundle, recorded
by `record-bundle.config.mjs`. Licence texts that no package publishes are kept
in `vendor/`, and `sources.json` records where each came from and the versions
it was checked against, so a dependency update that outgrows them stops the
run instead of producing a notice nobody verified.
"""

import argparse
import hashlib
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from collections import OrderedDict, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
TAURI = os.path.join(REPO, "src-tauri")
OUTPUT = os.path.join(REPO, "THIRD-PARTY-NOTICES.txt")
TARGET = "x86_64-pc-windows-msvc"
CSS_PACKAGES = ("tailwindcss", "tw-animate-css", "shadcn")

LICENSE_FILE = re.compile(r"^(licen[cs]e|copying|copyright|notice|unlicense|ofl)([-_.].*)?$", re.I)
SPDX_FILE = re.compile(r"\.spdx$", re.I)
COPYRIGHT_LINE = re.compile(r"^\s*(copyright\b|\(c\)|©)", re.I)
PLACEHOLDER = re.compile(r"\[yyyy\]|\[name of copyright owner\]|<year>|<copyright holders>", re.I)
MIT_MARKERS = (
    "permission is hereby granted, free of charge",
    "the above copyright notice and this permission notice shall be included",
)
APACHE, MPL, OFL = "Apache License 2.0", "Mozilla Public License 2.0", "SIL Open Font License 1.1"
SHARED_TITLES = (APACHE, MPL, OFL)
NO_NOTICE_IDS = ("CC0-1.0", "MIT-0", "UNLICENSE", "0BSD")
NO_NOTICE_FILES = ("CC0", "MIT0", "UNLICENSE")
BODY_START = re.compile(
    r"permission is hereby granted|^\s*sil open font license|^\s*apache license|^\s*mozilla public license",
    re.I | re.M,
)
MIT_MAX_LENGTH = 1500
FULL_TEXT_MARKERS = {
    APACHE: "terms and conditions for use, reproduction, and distribution",
    MPL: "1. definitions",
    OFL: "preamble",
}


class NoticeError(Exception):
    pass


def norm(text):
    return re.sub(r"\s+", " ", text).strip().lower()


def read(path):
    with open(path, encoding="utf-8", errors="replace") as handle:
        return handle.read().replace("\r\n", "\n").replace("\r", "\n").strip("\n")


def alternatives(declared):
    return [a.strip().strip("()").upper() for a in re.split(r"\s+OR\s+|/", declared or "") if a.strip()]


def license_files(directory):
    found = []
    for name in sorted(os.listdir(directory)):
        full = os.path.join(directory, name)
        if os.path.isfile(full) and LICENSE_FILE.match(name) and not SPDX_FILE.search(name):
            found.append(full)
        elif os.path.isdir(full) and name.lower() in ("licenses", "license"):
            found += [os.path.join(full, n) for n in sorted(os.listdir(full))]
    return found


def spdx_copyright(directory):
    lines = []
    for name in sorted(os.listdir(directory)):
        if SPDX_FILE.search(name):
            for line in read(os.path.join(directory, name)).split("\n"):
                if line.startswith("PackageCopyrightText:"):
                    value = re.sub(r"</?text>", "", line.split(":", 1)[1]).strip()
                    lines.append(value if value.lower().startswith("copyright") else f"Copyright {value}")
    return lines


def notice_lines(fragment):
    return [line.strip() for line in fragment.split("\n") if COPYRIGHT_LINE.match(line) and not PLACEHOLDER.search(line)]


def split_copyright(text):
    match = BODY_START.search(text)
    if not match:
        return notice_lines(text), text
    header, body = text[: match.start()], text[match.start():]
    holders = notice_lines(header)
    end = body.find("END OF TERMS AND CONDITIONS")
    if end >= 0:
        holders += [h for h in notice_lines(body[end:]) if re.search(r"\d{4}", h)]
    return holders, body


def is_mit(text):
    n = norm(text)
    body = norm(split_copyright(text)[1])
    return all(marker in n for marker in MIT_MARKERS) and len(body) <= MIT_MAX_LENGTH and "isc license" not in n


def title_of(text, fallback):
    n = norm(text[:600])
    for needle, title in (
        ("apache license", APACHE),
        ("sil open font license", OFL),
        ("mozilla public license", MPL),
        ("unicode", "Unicode License v3"),
        ("this is free and unencumbered software", "The Unlicense"),
        ("boost software license", "Boost Software License 1.0"),
        ("creative commons legal code cc0", "CC0 1.0 Universal"),
        ("mit no attribution", "MIT No Attribution"),
        ("permission to use, copy, modify, and/or distribute", "ISC License"),
        ("permission to use, copy, modify, and distribute", "ISC License"),
        ("redistribution and use in source and binary forms", "BSD-style License"),
        ("this software is provided 'as-is'", "zlib License"),
    ):
        if needle in n:
            return title
    return fallback


def run(command, cwd, env=None):
    result = subprocess.run(command, cwd=cwd, env=env, capture_output=True, text=True, encoding="utf-8")
    if result.returncode != 0:
        raise NoticeError(f"`{' '.join(command)}` failed:\n{result.stderr.strip()}")
    return result.stdout


def cargo_metadata():
    return json.loads(run(["cargo", "metadata", "--format-version", "1", "--filter-platform", TARGET, "--locked"], TAURI))


def bundled_modules():
    vite = os.path.join(REPO, "node_modules", "vite", "bin", "vite.js")
    if not os.path.exists(vite):
        raise NoticeError("node_modules is missing: run `pnpm install` first.")
    with tempfile.TemporaryDirectory() as scratch:
        modules_file = os.path.join(scratch, "modules.json")
        env = dict(os.environ, NOTICES_MODULES_FILE=modules_file, NOTICES_OUT_DIR=os.path.join(scratch, "dist"))
        config = os.path.join(HERE, "record-bundle.config.mjs")
        run([shutil.which("node") or "node", vite, "build", "--config", config, "--logLevel", "error"], REPO, env)
        with open(modules_file, encoding="utf-8") as handle:
            return json.load(handle)


def generate():
    sources = json.load(open(os.path.join(HERE, "sources.json"), encoding="utf-8"))
    vendored = {key: os.path.join(HERE, entry["licence"]) for key, entry in sources.items()}

    mit_body = None
    mit_notices = []
    mit_without_holder = []
    shared = {title: {"text": None, "users": []} for title in SHARED_TITLES}
    texts = OrderedDict()
    text_users = defaultdict(list)

    def record(label, declared, files, authors, extra_holders):
        nonlocal mit_body
        chosen = list(files)
        options = alternatives(declared)
        keep = [f for f in files if re.search(r"COPYRIGHT|NOTICE|THIRD", os.path.basename(f).upper())]
        if len(options) > 1:
            mit_files = [f for f in files if is_mit(read(f))]
            free = [f for f in files if any(k in os.path.basename(f).upper().replace("-", "") for k in NO_NOTICE_FILES)]
            if "MIT" in options and mit_files:
                chosen = mit_files + [f for f in keep if f not in mit_files]
            elif free and any(o in NO_NOTICE_IDS for o in options):
                chosen = free[:1] + [f for f in keep if f not in free]
        recorded = False
        for path in chosen:
            text = read(path)
            if not text.strip():
                continue
            recorded = True
            if is_mit(text):
                holders, body = split_copyright(text)
                holders += extra_holders
                if mit_body is None:
                    mit_body = body.strip()
                if holders:
                    mit_notices.append((label, holders))
                else:
                    mit_without_holder.append((label, [a for a in authors if a]))
                continue
            title = title_of(text, os.path.basename(path))
            if title in shared and FULL_TEXT_MARKERS[title] not in norm(text):
                title = os.path.basename(path)
            if title in shared:
                block = shared[title]
                if block["text"] is None and (title != APACHE or "END OF TERMS AND CONDITIONS" in text):
                    block["text"] = split_copyright(text)[1].strip()
                block["users"].append((label, split_copyright(text)[0] + extra_holders))
                continue
            key = hashlib.sha256(norm(text).encode()).hexdigest()
            if title == os.path.basename(path):
                title = f"{title} ({label})"
            texts.setdefault(key, (title, text))
            text_users[key].append(label)
        return recorded

    meta = cargo_metadata()
    packages = {p["id"]: p for p in meta["packages"]}
    nodes = {n["id"]: n for n in meta["resolve"]["nodes"]}
    root = meta["resolve"]["root"]
    shipped, stack = set(), [root]
    while stack:
        current = stack.pop()
        if current in shipped:
            continue
        shipped.add(current)
        for dep in nodes[current]["deps"]:
            if not any(kind["kind"] is None for kind in dep["dep_kinds"]):
                continue
            if any("proc-macro" in t["kind"] for t in packages[dep["pkg"]]["targets"]):
                continue
            stack.append(dep["pkg"])
    shipped.discard(root)
    rust = sorted((packages[i] for i in shipped), key=lambda p: (p["name"], p["version"]))
    by_name = {p["name"]: p for p in rust}

    upstream = sources["webview2Rs"]["crates"]
    for name, version in upstream.items():
        if name in by_name and by_name[name]["version"] != version:
            raise NoticeError(
                f"{name} is now {by_name[name]['version']}, but vendor/webview2-rs-LICENSE.txt was checked against "
                f"{version}. Fetch the LICENSE from the commit in that crate's .cargo_vcs_info.json, then update sources.json."
            )

    sdk = sources["webview2Sdk"]
    loader_crate = by_name.get(sdk["crate"])
    if loader_crate is None or loader_crate["version"] != sdk["crateVersion"]:
        raise NoticeError(
            f"{sdk['crate']} is no longer {sdk['crateVersion']}. Check which WebView2 SDK it ships, refresh "
            "vendor/webview2-sdk-LICENSE.txt from that SDK's NuGet package, then update sources.json."
        )
    loader = os.path.join(os.path.dirname(loader_crate["manifest_path"]), *sdk["loader"].split("/"))
    if hashlib.sha256(open(loader, "rb").read()).hexdigest() != sdk["loaderSha256"]:
        raise NoticeError(f"{sdk['loader']} in {sdk['crate']} is not the loader sources.json records.")

    sqlite_crate = by_name["libsqlite3-sys"]
    sqlite_header = os.path.join(os.path.dirname(sqlite_crate["manifest_path"]), "sqlite3", "sqlite3.h")
    sqlite_version = re.search(r'#define SQLITE_VERSION\s+"([^"]+)"', read(sqlite_header)).group(1)

    missing = []
    for p in rust:
        label = f"{p['name']} {p['version']}"
        directory = os.path.dirname(p["manifest_path"])
        files = license_files(directory)
        if not files and p["name"] in upstream:
            files = [vendored["webview2Rs"]]
        authors = p.get("authors") or []
        if not record(label, p.get("license"), files, authors, spdx_copyright(directory)):
            missing.append((label, p.get("license"), authors, p.get("repository"), spdx_copyright(directory)))

    npm_dirs = {}
    for module in bundled_modules():
        module = module.replace("\\", "/")
        match = re.search(r"^(.*?node_modules/\.pnpm/[^/]+/node_modules/((?:@[^/]+/)?[^/]+))", module)
        if match:
            directory = match.group(1)
            npm_dirs[match.group(2)] = directory if os.path.isabs(directory) else os.path.join(REPO, directory)
    for name in CSS_PACKAGES:
        npm_dirs[name] = os.path.realpath(os.path.join(REPO, "node_modules", name))

    npm, fonts = [], []
    for name in sorted(npm_dirs):
        directory = npm_dirs[name]
        manifest = json.load(open(os.path.join(directory, "package.json"), encoding="utf-8"))
        declared = manifest.get("license") or (manifest.get("licenses") or [{}])[0].get("type")
        label = f"{name} {manifest['version']}"
        author = manifest.get("author")
        author = author.get("name") if isinstance(author, dict) else author
        if not record(label, declared, license_files(directory), [author] if author else [], spdx_copyright(directory)):
            missing.append((label, declared, [author] if author else [], None, spdx_copyright(directory)))
        (fonts if name.startswith("@fontsource") else npm).append((name, manifest["version"], declared))

    literata = read(os.path.join(TAURI, "assets", "fonts", "Literata-OFL.txt"))
    shared[OFL]["users"].append(("Literata, embedded in wattle.exe for HTML export", split_copyright(literata)[0]))
    shared[OFL]["text"] = shared[OFL]["text"] or split_copyright(literata)[1].strip()

    flags = sources["flagIcons"]
    mit_notices.append((f"flag-icons ({flags['appliesTo']})", split_copyright(read(vendored["flagIcons"]))[0]))
    webview2_text = read(vendored["webview2Sdk"])
    webview2_key = hashlib.sha256(norm(webview2_text).encode()).hexdigest()
    texts[webview2_key] = ("Microsoft WebView2 SDK License", webview2_text)
    text_users[webview2_key].append(f"Microsoft WebView2 loader, WebView2 SDK {sdk['sdkVersion']}")

    by_repository = defaultdict(list)
    for p in rust:
        if p.get("repository") and license_files(os.path.dirname(p["manifest_path"])):
            by_repository[p["repository"]].append(f"{p['name']} {p['version']}")
    unresolved = []
    for label, declared, authors, repository, spdx in missing:
        options = alternatives(declared)
        note = " (its package ships no licence file)"
        metadata = spdx + ([f"Authors as declared in package metadata: {'; '.join(a for a in authors if a)}"] if any(authors) else [])
        if "MIT" in options:
            if metadata:
                mit_notices.append((label + note, metadata))
            else:
                mit_without_holder.append((label + note, []))
        elif "MPL-2.0" in options:
            shared[MPL]["users"].append((label + note, metadata))
        elif repository in by_repository:
            sibling = by_repository[repository][0]
            for key in texts:
                if sibling in text_users[key]:
                    text_users[key].append(f"{label}{note[:-1]}; same repository as {sibling})")
        else:
            unresolved.append(f"{label} ({declared})")
    if unresolved:
        raise NoticeError(
            "No licence text could be found for: " + ", ".join(unresolved)
            + ". Find the text the project publishes and vendor it rather than writing one."
        )

    sysroot = run(["rustc", "--print", "sysroot"], TAURI).strip()
    rust_version = run(["rustc", "--version"], TAURI).strip()
    std_html = open(os.path.join(sysroot, "share", "doc", "rust", "COPYRIGHT-library.html"), encoding="utf-8").read()
    std_html = re.sub(r"(?is)<(script|style|title)[^>]*>.*?</\1>", "", std_html)
    std_text = html.unescape(re.sub(r"<[^>]+>", "", std_html))
    std_text = "\n".join(line.strip() for line in std_text.split("\n"))
    std_text = re.sub(r"\n{3,}", "\n\n", std_text).strip()

    lines = []
    w = lines.append
    rule, thin = "=" * 78, "-" * 78

    def holders_block(entries):
        for label, holders in sorted(entries, key=lambda item: item[0].lower()):
            w(f"  {label}")
            for holder in dict.fromkeys(holders):
                w(f"    {holder}")

    w("THIRD-PARTY SOFTWARE NOTICES")
    w("Wattle for Windows")
    w("")
    w("Wattle is Copyright (c) 2026 Mattia (mattiach) and is licensed under the MIT")
    w("License; see LICENSE.txt in the installation folder.")
    w("")
    w("The Windows build of Wattle includes the third-party software and assets")
    w("listed in Part 1. Part 2 reproduces their copyright notices and licence")
    w("texts; Part 3 reproduces the copyright notices of the Rust standard library.")
    w("")
    w("How this file was produced. Rust crates come from Cargo.lock, read with")
    w("`cargo metadata --filter-platform x86_64-pc-windows-msvc`, following normal")
    w("dependencies only: build scripts and procedural macros run while compiling")
    w("and are not part of the program. JavaScript, CSS and fonts are the modules")
    w("Vite writes into the production bundle, resolved through pnpm-lock.yaml,")
    w("plus the stylesheets the bundle's CSS is generated from. Copyright lines")
    w("and licence texts are taken from the files each package publishes. Where a")
    w("package is offered under a choice of licences that includes MIT, it is used")
    w("here under MIT. Identical licence texts are given once, with every copyright")
    w("notice they apply to listed above them.")
    w("")
    w(rule)
    w("PART 1 - INVENTORY")
    w(rule)
    w("")
    w(f"1.1 Rust crates compiled into wattle.exe ({len(rust)})")
    w("")
    for p in rust:
        w(f"  {p['name']} {p['version']} - {p.get('license') or '(see licence file)'}")
    w("")
    w("1.2 The Rust standard library")
    w("")
    w(f"  Compiled into wattle.exe by {rust_version}: Apache-2.0 OR MIT, with the")
    w("  exceptions recorded in its own copyright notices (Part 3).")
    w("")
    w("1.3 Native code carried by Rust crates")
    w("")
    w(f"  SQLite {sqlite_version}, compiled from the amalgamation bundled in libsqlite3-sys")
    w(f"    {sqlite_crate['version']}. The SQLite authors have dedicated SQLite to the public domain:")
    w("    https://www.sqlite.org/copyright.html")
    w(f"  Microsoft WebView2 loader from the WebView2 SDK {sdk['sdkVersion']}")
    w(f"    ({os.path.basename(sdk['loader'])}, statically linked through {sdk['crate']}")
    w(f"    {sdk['crateVersion']}). Microsoft WebView2 SDK License, reproduced in Part 2.")
    w("")
    w(f"1.4 JavaScript and CSS packages in the application bundle ({len(npm)})")
    w("")
    for name, version, declared in npm:
        w(f"  {name} {version} - {declared}")
    w("")
    w(f"1.5 Fonts ({len(fonts) + 1})")
    w("")
    for name, version, declared in fonts:
        w(f"  {name} {version} - {declared}")
    w("  Literata (written beside exported HTML pages) - OFL-1.1")
    w("")
    w("1.6 Other assets")
    w("")
    w("  flag-icons - MIT. The language flags are adapted from")
    w("    https://github.com/lipis/flag-icons")
    w("")
    w("1.7 Source code of MPL-2.0 components")
    w("")
    w("  These components are licensed under the Mozilla Public License 2.0 and are")
    w("  used unmodified. Their source code is available at:")
    for p in rust:
        if "MPL" in (p.get("license") or ""):
            w(f"  {p['name']} {p['version']}")
            w(f"    https://crates.io/crates/{p['name']}/{p['version']}")
            if p.get("repository"):
                w(f"    {p['repository']}")
    w("")
    w(rule)
    w("PART 2 - COPYRIGHT NOTICES AND LICENCE TEXTS")
    w(rule)
    w("")
    w(thin)
    w("MIT License")
    w(thin)
    w("")
    w("Applies to the components below, each under its own copyright notice:")
    w("")
    holders_block(mit_notices)
    if mit_without_holder:
        w("")
        w("  These publish the MIT License without a copyright line:")
        for label, _authors in sorted(mit_without_holder, key=lambda item: item[0].lower()):
            w(f"    {label}")
    w("")
    w(mit_body)
    w("")
    for title in SHARED_TITLES:
        block = shared[title]
        if not block["users"]:
            continue
        w(thin)
        w(title)
        w(thin)
        w("")
        w("Applies to the components below, each under its own copyright notice where")
        w("one is published:")
        w("")
        holders_block(block["users"])
        w("")
        w(block["text"])
        w("")
    for key, (title, text) in texts.items():
        w(thin)
        w(title)
        w(thin)
        w("")
        w("Applies to:")
        for user in sorted(set(text_users[key]), key=str.lower):
            w(f"  {user}")
        w("")
        w(text)
        w("")
    w(rule)
    w("PART 3 - COPYRIGHT NOTICES OF THE RUST STANDARD LIBRARY")
    w(rule)
    w("")
    w(std_text)
    w("")

    summary = f"{len(rust)} Rust crates, {len(npm)} JavaScript/CSS packages, {len(fonts) + 1} fonts, {rust_version}"
    return "\n".join(lines), summary


def main():
    parser = argparse.ArgumentParser(description="Regenerate THIRD-PARTY-NOTICES.txt.")
    parser.add_argument("--check", action="store_true", help="fail if the committed file is out of date; never write it")
    check = parser.parse_args().check
    try:
        notices, summary = generate()
    except NoticeError as error:
        print(f"generate-notices: {error}", file=sys.stderr)
        return 2

    if not check:
        with open(OUTPUT, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(notices)
        print(f"Wrote THIRD-PARTY-NOTICES.txt: {summary}.")
        return 0

    committed = read(OUTPUT) if os.path.exists(OUTPUT) else ""
    if committed == notices.strip("\n"):
        print(f"THIRD-PARTY-NOTICES.txt is up to date: {summary}.")
        return 0
    old, new = committed.split("\n"), notices.strip("\n").split("\n")
    line = next((i for i, (a, b) in enumerate(zip(old, new)) if a != b), min(len(old), len(new)))
    print("THIRD-PARTY-NOTICES.txt is out of date with the dependencies.", file=sys.stderr)
    print(f"  First difference at line {line + 1}:", file=sys.stderr)
    print(f"    committed: {old[line] if line < len(old) else '(end of file)'}", file=sys.stderr)
    print(f"    generated: {new[line] if line < len(new) else '(end of file)'}", file=sys.stderr)
    print("  Run `pnpm generate:notices` and commit the result.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())

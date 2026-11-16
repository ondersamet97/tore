#!/usr/bin/env python3
"""Write the public release tree: allowlisted, Git-tracked files only. Never Git history or user data.

    python3 scripts/export-public.py --output /absolute/empty/or/new/folder

The public repository receives one commit per release made from this tree. The
allowlist and content checks are shared with package-preview.py. Pattern checks
supplement manual review; they cannot prove the absence of confidential content.
"""
import argparse, hashlib, importlib.util, json, re, shutil, subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('package_preview', ROOT / 'scripts/package-preview.py')
preview = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preview)

# Reviewed additions on top of the audited preview allowlist.
EXTRA = ['scripts/export-public.py', 'ABOUT.md']
EXTRA_PATTERNS = [r'docs/RELEASE-0\.(?:1[2-9]|[2-9]\d)\.\d+\.md']
# Screenshots are binary and cannot be pattern-scanned: each one is listed by name
# after a person has looked at it and confirmed it shows synthetic data only.
REVIEWED_IMAGES = ['docs/images/topic.png', 'docs/images/record.png', 'docs/images/thinkers.png', 'docs/images/dreams.png']


def tracked():
    out = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode()
    return {p for p in out.split('\0') if p}


def version():
    return re.search(r'^version = "([^"]+)"$', (ROOT / 'server/Cargo.toml').read_text(), re.M).group(1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--output', type=Path, required=True)
    args = ap.parse_args()
    out = args.output.resolve()
    if out == ROOT or ROOT in out.parents:
        raise SystemExit('Output must be outside the source tree.')
    if out.exists() and any(p.name != '.git' for p in out.iterdir()):
        raise SystemExit('Output folder must be empty (a .git folder may remain).')
    if subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT).strip():
        raise SystemExit('Commit the release first: the working tree has uncommitted changes.')
    files = tracked()
    allowed = {p.relative_to(ROOT).as_posix() for p in preview.candidates()} | set(EXTRA)
    allowed |= {p for p in files if any(re.fullmatch(x, p) for x in EXTRA_PATTERNS)}
    chosen = sorted(allowed & files)
    untracked = sorted(p for p in allowed - files if (ROOT / p).exists())
    if untracked:
        raise SystemExit('Allowlisted but not tracked by Git: ' + ', '.join(untracked[:10]))
    readme = (ROOT / 'README.md').read_text(encoding='utf-8')
    if version() not in readme:
        raise SystemExit('README does not mention version ' + version())
    manifest = []
    out.mkdir(parents=True, exist_ok=True)
    for name in chosen:
        path = ROOT / name
        data = path.read_bytes()
        preview.scan(path, data)
        manifest.append({'path': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    for name in REVIEWED_IMAGES:
        path = ROOT / name
        if name not in files:
            raise SystemExit('Reviewed image is not tracked: ' + name)
        preview.validate_path(path)
        data = path.read_bytes()
        if not data.startswith(b'\x89PNG\r\n\x1a\n'):
            raise SystemExit('Not a PNG: ' + name)
        manifest.append({'path': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    for entry in manifest:
        target = out / entry['path']
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / entry['path'], target)
        target.chmod(0o755 if entry['path'].endswith(('.sh', '.command')) else 0o644)
    print(json.dumps({'version': version(), 'fileCount': len(manifest), 'bytes': sum(e['bytes'] for e in manifest),
                      'treeSha256': hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest(),
                      'containsGitHistory': False}))


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Build a review-only source snapshot using an allowlist, never Git history/user data."""
import argparse, hashlib, json, re, zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
ROOT_FILES=['README.md','CHANGELOG.md','LICENSE','NOTICE.md','.gitignore','Başlat.command']
DOCS=['PREVIEW-ARCHITECTURE.md','PREVIEW-LIMITATIONS.md','THIRD-PARTY-NOTICES.md','RECORDS-CONTRACT.md','model-catalog-snapshot.json']
SCRIPTS=['build.sh','build-core.sh','verify-records.py','verify-opinions.py','verify-ideology.py','workspace-e2e.cjs','package-preview.py']
TREES=['server/src','core/src','core/fixtures','core/pkg','core/pkg-node','web','vendor','licenses','fixtures','local-reader/src','local-reader/vendor','local-reader/tests']
EXAMPLE_FILES=['teori-test-konusmasi.txt','TEST - Türkçe Okuma.md','TEST - Güvenilmeyen İçerik.md','Okuma Grubu Planlama Raporu - Sentetik Test.md']
EXACT=[f'local-reader/ornekler/{p}' for p in EXAMPLE_FILES]+ROOT_FILES+[f'docs/{p}' for p in DOCS]+[f'scripts/{p}' for p in SCRIPTS]+['server/Cargo.toml','server/Cargo.lock','core/Cargo.toml','core/Cargo.lock','local-reader/package.json','local-reader/package-lock.json','local-reader/build.cjs']
def candidates():
    paths={ROOT/p for p in EXACT}
    for directory in TREES:
        paths.update(p for p in (ROOT/directory).rglob('*') if p.is_file() and not any(x in ('node_modules','target','__pycache__','.DS_Store') for x in p.parts))
    return sorted(paths,key=lambda p:p.relative_to(ROOT).as_posix())
def validate_path(path):
    if not path.resolve().is_relative_to(ROOT.resolve()):raise ValueError('Path escapes source root')
    for part in (path, *path.parents):
        if part==ROOT:break
        if part.is_symlink():raise ValueError('Symlink in source allowlist')
def scan(path,data):
    validate_path(path)
    relative=path.relative_to(ROOT).as_posix()
    if path.is_symlink():raise ValueError('Symlink in source allowlist: '+relative)
    if any(x in relative.split('/') for x in ('.git','.demo-data','.preview-data','.verification','.private')):raise ValueError('Private path in allowlist')
    if path.suffix=='.wasm' and (b'/Users/' in data or b'/home/' in data):raise ValueError('Build path in WASM: '+relative)
    # Concrete personal paths are forbidden; generic synthetic privacy test inputs remain tests.
    if re.search(rb'/(?:Users|home)/(?!test[ /]|demo[ /]|synthetic[ /])[^\s/"\'<>]+/',data):raise ValueError('Personal absolute path in '+relative)
    credential_scan=data.replace(b'sk-or-v1-' + b'never-persist-this-secret', b'SYNTHETIC_TEST_KEY') if relative=='server/src/workspace/tests.rs' else data
    if re.search(rb'(?:sk-proj-|sk-or-v1-|ghp_|github_pat_)[A-Za-z0-9_-]{20,}',credential_scan):raise ValueError('Credential-shaped value in '+relative)
    if re.search(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',data):raise ValueError('Private key in '+relative)
    if re.search(rb'"localToken"\s*:\s*"[a-f0-9]{64}"',data):raise ValueError('Runtime token in '+relative)
    if path.suffix in ('.log','.pem','.key','.pdf','.png','.jpg','.jpeg','.zip'):raise ValueError('Unreviewed artifact in '+relative)
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--output',type=Path,required=True);args=ap.parse_args()
    # The audited rc.1 archive is immutable; do not label newer sources as rc.1.
    if not re.search(r'^version = "0\.11\.0-rc\.1"$', (ROOT/"server/Cargo.toml").read_text(), re.M):
        raise SystemExit("This packager targets the audited rc.1 snapshot. Prepare a new release inventory for newer sources.")
    files=[];contents=[]
    for path in candidates():
        validate_path(path);data=path.read_bytes();scan(path,data);name=path.relative_to(ROOT).as_posix();contents.append((name,data))
        files.append({'path':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
    manifest={'version':'0.11.0-rc.1','publicationStatus':'LOCAL_REVIEW_ONLY_NOT_PUBLISHED','licenseStatus':'AGPL-3.0-only','containsGitHistory':False,'containsPersonalStore':False,'files':files,'scanLimitations':['Pattern checks supplement manual review; they cannot prove absence of all confidential information.','Synthetic redaction test strings are intentional.','The compressed Codex fixture is checked through importer tests.']}
    contents.append(('PREVIEW-MANIFEST.json',(json.dumps(manifest,indent=2)+'\n').encode()))
    args.output.parent.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(args.output,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
        for name,data in contents:
            info=zipfile.ZipInfo('tore-0.11.0-rc.1/'+name,date_time=(2026,11,15,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.create_system=3
            info.external_attr=(0o100755 if name.endswith(('.sh','.command')) else 0o100644)<<16
            archive.writestr(info,data)
    print(json.dumps({'fileCount':len(contents),'bytes':args.output.stat().st_size,'sha256':hashlib.sha256(args.output.read_bytes()).hexdigest(),'localOnly':True}))
if __name__=='__main__':main()

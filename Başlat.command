#!/bin/bash
set -euo pipefail
umask 077
cd "$(dirname "$0")"
ROOT_DIR="$(pwd -P)"
DEMO_DIR="$ROOT_DIR/.demo-data"
# No production path, application bundle, Keychain or cloud configuration is used.
mkdir -p "$DEMO_DIR/archive" "$DEMO_DIR/runtime"
if python3 - "$DEMO_DIR/runtime/.tore-runtime/runtime.json" <<'PY_REUSE'
import json,re,sys,subprocess,urllib.request,urllib.parse
from pathlib import Path
try:
    runtime=json.loads(Path(sys.argv[1]).read_text())
    base=runtime['url']; token=runtime['localToken']; uri=urllib.parse.urlparse(base)
    if uri.scheme!='http' or uri.hostname!='127.0.0.1' or not uri.port or uri.path not in ('','/') or uri.query or uri.fragment or not re.fullmatch('[a-f0-9]{64}',token):
        raise ValueError('runtime')
    request=urllib.request.Request(base+'/api/private/tore/status',data=b'{}',headers={'Authorization':'Bearer '+token,'Origin':base,'Content-Type':'application/json'},method='POST')
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args): return None
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
    with opener.open(request,timeout=2) as response:
        status=json.load(response)
    if status.get('version')!='0.12.2': raise ValueError('version')
    subprocess.run(['open',base+'/#local='+token],check=True)
    print('Çalışan Töre demo oturumu açıldı.')
except Exception:
    sys.exit(1)
PY_REUSE
then
  exit 0
fi
TORE_BINARY_HELP=""
if [[ -x "$ROOT_DIR/server/target/debug/tore-server" ]]; then
  TORE_BINARY_HELP="$("$ROOT_DIR/server/target/debug/tore-server" --help 2>/dev/null || true)"
fi
# Never launch an older binary that can still run the retired local model.
if [[ "$TORE_BINARY_HELP" != "Töre 0.12.2 "* ]]; then
  "$ROOT_DIR/scripts/build.sh"
fi
exec "$ROOT_DIR/server/target/debug/tore-server" \
  --archive "$DEMO_DIR/archive" \
  --data "$DEMO_DIR/runtime" \
  --listen 127.0.0.1:0 --open

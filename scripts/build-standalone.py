#!/usr/bin/env python3
"""Build Map Fox's no-server, single-file HTML distribution from maintained sources."""
from pathlib import Path
import base64
import re

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / 'index.html').read_text(encoding='utf-8')
CSS = (ROOT / 'styles' / 'app.css').read_text(encoding='utf-8')
MODULES = ('renderer.mjs', 'spawner.mjs', 'importer.mjs', 'subdivisions.mjs', 'native-map.mjs', 'native-politics.mjs', 'master-map.mjs', 'native-export.mjs', 'native-preview.mjs', 'app.mjs', 'navigation.mjs')


def bundle_module(source):
    # Static ESM imports only; the offline build needs no third-party bundler.
    source = re.sub(r"^import\s+\{[^\n]*?\}\s+from\s+['\"][^'\"]+['\"];\s*\n", '', source, flags=re.M)
    source = re.sub(r'^export\s+\{[^\n]*?\};\s*\n', '', source, flags=re.M)
    return re.sub(r'^export\s+(?=(?:async\s+function|const|let|function|class)\b)', '', source, flags=re.M)


scripts = '\n\n'.join(bundle_module((ROOT / 'src' / name).read_text(encoding='utf-8')) for name in MODULES)
assert 'import {' not in scripts and '\nexport ' not in scripts
logo = base64.b64encode((ROOT / 'assets' / 'map-fox-logo.png').read_bytes()).decode('ascii')
HTML = HTML.replace('<link rel="stylesheet" href="./styles/app.css"/>', '<style>\n' + CSS + '\n</style>')
HTML = HTML.replace('src="./assets/map-fox-logo.png"', 'src="data:image/png;base64,' + logo + '"')
HTML = HTML.replace('<script type="module" src="./src/navigation.mjs"></script>', '<script>\n' + scripts + '\n</script>')
assert '<script>\n' in HTML and 'type="module"' not in HTML

out = ROOT / 'dist' / 'Map_Fox_0.7.3_Standalone.html'
out.parent.mkdir(exist_ok=True)
out.write_text(HTML, encoding='utf-8')
print(f'Built {out.relative_to(ROOT)} ({out.stat().st_size:,} bytes)')

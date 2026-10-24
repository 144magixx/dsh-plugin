"""Validate an npm tarball without extracting or executing anything."""
from pathlib import Path, PurePosixPath
import hashlib
import json
import sys
import tarfile

root = Path(__file__).resolve().parent.parent
archive = Path(sys.argv[1]).resolve()
assert archive.parent == root / 'artifacts', 'Only inspect this workspace artifact directory'
required = {'package.json', 'cordis.patch.yml', 'lib/index.js', 'lib/service.js', 'lib/history.js', 'lib/client.js', 'locale/en.json', 'locale/zh.json', 'icon.svg', 'README.md', 'LICENSE'}
seen = set()
with tarfile.open(archive, 'r:gz') as tgz:
    for member in tgz.getmembers():
        name = PurePosixPath(member.name)
        assert name.parts[0] == 'package' and '..' not in name.parts
        assert member.isfile(), f'Unexpected non-regular archive member: {name}'
        relative = '/'.join(name.parts[1:])
        assert not any(part in {'.runtime', '.integration-data', 'node_modules', '.git'} for part in name.parts)
        assert relative not in seen, f'Duplicate archive member: {relative}'
        seen.add(relative)
        actual = tgz.extractfile(member).read()
        expected = (root / relative).read_bytes()
        if relative == 'package.json':
            # pnpm formats and reorders manifest fields while packing.
            assert json.loads(actual) == json.loads(expected), 'Packed manifest semantics differ'
            pkg = json.loads(actual)
            assert pkg['name'] == 'dsh-side-branch' and pkg['version'] == '0.1.0'
            assert not pkg.get('dependencies')
            assert not any(key in pkg.get('scripts', {}) for key in ['preinstall', 'install', 'postinstall'])
        else:
            assert actual == expected, f'Archive differs from source: {relative}'
assert required <= seen, f'Missing distribution members: {required - seen}'
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
archive.with_suffix(archive.suffix + '.sha256').write_text(f'{digest}  {archive.name}\n', encoding='utf-8')
print(f'Verified {len(seen)} files; runtime/test snapshots excluded; source bytes and normalized manifest match workspace.')
print(f'SHA256 {digest}')
